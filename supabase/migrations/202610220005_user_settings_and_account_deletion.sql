-- Per-user preferences and an atomic cleanup of known aquarium-owned records.
-- Requires the ownership migration and the base aquarium/sensor tables.

create table if not exists public.aquasense_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications jsonb not null default '{"waterQuality":true,"temperature":true,"ph":true,"maintenance":true,"feeding":true,"browser":false,"email":false,"quietHoursEnabled":false,"quietStart":"22:00","quietEnd":"07:00"}'::jsonb,
  appearance jsonb not null default '{"theme":"system","temperatureUnit":"C","timeFormat":"12h","dateFormat":"locale"}'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(notifications) = 'object'),
  check (jsonb_typeof(appearance) = 'object')
);

alter table public.aquasense_user_preferences enable row level security;
revoke all on public.aquasense_user_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.aquasense_user_preferences to authenticated;

-- Establish a known policy baseline even if a partially-created table existed.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'aquasense_user_preferences'
  loop
    execute format('drop policy %I on public.aquasense_user_preferences', p.policyname);
  end loop;
end $$;

create policy "Users manage their own preferences" on public.aquasense_user_preferences
  for all to authenticated
  using (user_id = auth.uid() and public.is_aquasense_owner_session() and public.is_aquasense_account_active())
  with check (user_id = auth.uid() and public.is_aquasense_owner_session() and public.is_aquasense_account_active());

-- Called only by the delete-account Edge Function with a service-role client.
-- The surrounding function call is one PostgreSQL transaction: either all
-- known aquarium rows are removed or none are. Unknown base-schema references
-- can cause a foreign-key error, which leaves the transaction unchanged.
create or replace function public.delete_aquasense_user_aquariums(target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare removed_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  delete from public.sensor_readings r
  using public.aquariums a
  where a.owner_id = target_user_id and r.aquarium_id = a.id;

  delete from public.aquarium_settings s
  using public.aquariums a
  where a.owner_id = target_user_id and s.aquarium_id = a.id;

  delete from public.aquarium_alerts x
  using public.aquariums a
  where a.owner_id = target_user_id and x.aquarium_id = a.id;

  delete from public.aquarium_care_tasks c
  using public.aquariums a
  where a.owner_id = target_user_id and c.aquarium_id = a.id;

  delete from public.aquarium_health_reports h
  using public.aquariums a
  where a.owner_id = target_user_id and h.aquarium_id = a.id;

  delete from public.aquariums where owner_id = target_user_id;
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;
revoke all on function public.delete_aquasense_user_aquariums(uuid) from public, anon, authenticated;
grant execute on function public.delete_aquasense_user_aquariums(uuid) to service_role;
