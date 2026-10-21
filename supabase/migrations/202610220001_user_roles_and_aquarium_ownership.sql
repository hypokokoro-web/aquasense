-- Add account ownership without changing the ESP32 sensor payload format.
-- Authenticated clients can read their own aquarium data; service_role ingestion
-- continues to bypass RLS. The existing aquasense_admins table is the trusted
-- administrator allowlist and cannot be modified by regular clients.

alter table public.aquariums
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists aquariums_owner_id_idx on public.aquariums(owner_id);

create or replace function public.owns_aquarium(target_aquarium_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.aquariums a
    where a.id = target_aquarium_id and a.owner_id = auth.uid()
  );
$$;
revoke all on function public.owns_aquarium(bigint) from public;
grant execute on function public.owns_aquarium(bigint) to authenticated;
grant execute on function public.owns_aquarium(bigint) to anon;
grant execute on function public.is_aquasense_admin() to anon;

alter table public.aquariums enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.aquarium_settings enable row level security;
alter table public.aquarium_alerts enable row level security;
alter table public.aquarium_care_tasks enable row level security;
alter table public.aquarium_health_reports enable row level security;
alter table public.aquasense_admins enable row level security;

-- Restrictive policies are ANDed with existing permissive policies. This
-- fences unknown public/admin policies without deleting device integrations.
create policy "Ownership fence for aquariums" on public.aquariums
  as restrictive for all to anon, authenticated
  using (owner_id = auth.uid() or public.is_aquasense_admin())
  with check (owner_id = auth.uid() or public.is_aquasense_admin());
create policy "Ownership fence for readings" on public.sensor_readings
  as restrictive for all to anon, authenticated
  using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Ownership fence for settings" on public.aquarium_settings
  as restrictive for all to anon, authenticated
  using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Ownership fence for alerts" on public.aquarium_alerts
  as restrictive for all to anon, authenticated
  using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Ownership fence for care tasks" on public.aquarium_care_tasks
  as restrictive for all to anon, authenticated
  using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Ownership fence for reports" on public.aquarium_health_reports
  as restrictive for all to anon, authenticated
  using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Membership fence" on public.aquasense_admins
  as restrictive for all to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A signed-in user may check only their own allowlist membership. No client
-- role may insert, update, or delete administrator assignments.
create policy "Users may verify their own administrator membership" on public.aquasense_admins
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.aquasense_admins from anon, authenticated;
grant select on public.aquasense_admins to authenticated;
revoke insert, update, delete on public.sensor_readings from anon, authenticated;

create policy "Aquarium owners and admins read aquariums" on public.aquariums
  for select to authenticated using (owner_id = auth.uid() or public.is_aquasense_admin());
create policy "Users create owned aquariums" on public.aquariums
  for insert to authenticated with check (owner_id = auth.uid());
create policy "Owners and admins update aquariums" on public.aquariums
  for update to authenticated using (owner_id = auth.uid() or public.is_aquasense_admin())
  with check (owner_id = auth.uid() or public.is_aquasense_admin());
create policy "Owners and admins delete aquariums" on public.aquariums
  for delete to authenticated using (owner_id = auth.uid() or public.is_aquasense_admin());

create policy "Aquarium owners and admins read sensor readings" on public.sensor_readings
  for select to authenticated using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Aquarium owners and admins read settings" on public.aquarium_settings
  for select to authenticated using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Aquarium owners and admins manage settings" on public.aquarium_settings
  for all to authenticated using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());

create policy "Aquarium owners and admins manage alerts" on public.aquarium_alerts
  for all to authenticated using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Aquarium owners and admins manage care tasks" on public.aquarium_care_tasks
  for all to authenticated using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());
create policy "Aquarium owners and admins manage reports" on public.aquarium_health_reports
  for all to authenticated using (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(aquarium_id) or public.is_aquasense_admin());

grant select, insert, update, delete on public.aquariums to authenticated;
grant select on public.sensor_readings to authenticated;
grant select, insert, update, delete on public.aquarium_settings to authenticated;
grant select, insert, update, delete on public.aquarium_alerts to authenticated;
grant select, insert, update, delete on public.aquarium_care_tasks to authenticated;
grant select, insert, update, delete on public.aquarium_health_reports to authenticated;
