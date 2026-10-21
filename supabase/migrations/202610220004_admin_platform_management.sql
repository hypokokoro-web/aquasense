-- Platform administration records. Private tables are accessed only by the
-- service-side aquasense-admin / ingest-reading functions.

create table if not exists public.aquasense_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (length(action) between 1 and 80),
  entity_type text not null check (length(entity_type) between 1 and 64),
  entity_id text,
  outcome text not null check (outcome in ('success', 'failure')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists aquasense_audit_logs_created_idx
  on public.aquasense_audit_logs(created_at desc);
create index if not exists aquasense_audit_logs_actor_idx
  on public.aquasense_audit_logs(actor_id, created_at desc);
create index if not exists aquasense_audit_logs_action_idx
  on public.aquasense_audit_logs(action, created_at desc);
alter table public.aquasense_audit_logs enable row level security;
revoke all on public.aquasense_audit_logs from public, anon, authenticated;
grant select, insert on public.aquasense_audit_logs to service_role;
grant usage, select on sequence public.aquasense_audit_logs_id_seq to service_role;

create table if not exists public.aquasense_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  message text not null check (length(trim(message)) between 1 and 5000),
  category text not null default 'general' check (category in ('general', 'maintenance', 'feature', 'important')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (publish_at is null or expires_at is null or expires_at > publish_at)
);
create index if not exists aquasense_announcements_active_idx
  on public.aquasense_announcements(status, publish_at, expires_at);
alter table public.aquasense_announcements enable row level security;
revoke all on public.aquasense_announcements from public, anon, authenticated;
grant select, insert, update on public.aquasense_announcements to service_role;

create table if not exists public.aquasense_platform_settings (
  setting_key text primary key check (setting_key in ('default_announcement_category', 'platform_timezone')),
  setting_value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.aquasense_platform_settings enable row level security;
revoke all on public.aquasense_platform_settings from public, anon, authenticated;
grant select, insert, update on public.aquasense_platform_settings to service_role;

-- The Explore page is an AI chat using this curated library. Its administration
-- UI edits the actual passages used by retrieval, rather than introducing a
-- separate unused content store.
alter table public.aquasense_knowledge_chunks
  add column if not exists category text not null default 'learning'
    check (category in ('fish', 'water_quality', 'care', 'learning')),
  add column if not exists is_published boolean not null default true,
  add column if not exists is_archived boolean not null default false,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
create index if not exists aquasense_knowledge_public_idx
  on public.aquasense_knowledge_chunks(is_published, is_archived, category);
revoke insert, update, delete on public.aquasense_knowledge_chunks from anon, authenticated;
revoke all on public.aquasense_knowledge_chunks from public, anon, authenticated;
grant select, insert, update on public.aquasense_knowledge_chunks to service_role;
revoke all on function public.search_aquasense_knowledge(text, integer) from public, anon, authenticated;
grant execute on function public.search_aquasense_knowledge(text, integer) to service_role;

create or replace function public.search_aquasense_knowledge(search_text text, result_limit integer default 4)
returns table (id bigint, title text, content text, source_title text, source_url text, rank real)
language sql
stable
security invoker
set search_path = public
as $$
  select k.id, k.title, k.content, k.source_title, k.source_url,
         ts_rank_cd(k.search_vector, websearch_to_tsquery('english', search_text)) as rank
  from public.aquasense_knowledge_chunks k
  where k.is_published and not k.is_archived
    and k.search_vector @@ websearch_to_tsquery('english', search_text)
  order by rank desc, k.id
  limit greatest(1, least(coalesce(result_limit, 4), 8));
$$;

create table if not exists public.aquasense_ingest_events (
  id bigint generated always as identity primary key,
  device_id text,
  aquarium_id bigint references public.aquariums(id) on delete set null,
  event_code text not null check (event_code in (
    'reading_accepted', 'invalid_payload', 'aquarium_mismatch', 'measurement_out_of_range',
    'rate_limited', 'database_insert_failed'
  )),
  outcome text not null check (outcome in ('success', 'rejected', 'error')),
  created_at timestamptz not null default now()
);
create index if not exists aquasense_ingest_events_created_idx
  on public.aquasense_ingest_events(created_at desc);
create index if not exists aquasense_ingest_events_device_idx
  on public.aquasense_ingest_events(device_id, created_at desc);
alter table public.aquasense_ingest_events enable row level security;
revoke all on public.aquasense_ingest_events from public, anon, authenticated;
grant select, insert on public.aquasense_ingest_events to service_role;
grant usage, select on sequence public.aquasense_ingest_events_id_seq to service_role;

-- Supabase Auth bans stop new sessions; this check also makes RLS reject a
-- suspended account's still-unexpired JWT on the protected aquarium tables.
create or replace function public.is_aquasense_account_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;
revoke all on function public.is_aquasense_account_active() from public;
grant execute on function public.is_aquasense_account_active() to authenticated;
grant execute on function public.is_aquasense_account_active() to anon;

create or replace function public.is_aquasense_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_aquasense_account_active()
    and coalesce((auth.jwt() -> 'amr') @> '[{"method":"password"}]'::jsonb, false)
    and exists (select 1 from public.aquasense_admins a where a.user_id = auth.uid());
$$;

create or replace function public.is_aquasense_owner_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_aquasense_account_active()
    and (not exists (select 1 from public.aquasense_admins a where a.user_id = auth.uid())
      or coalesce((auth.jwt() -> 'amr') @> '[{"method":"password"}]'::jsonb, false));
$$;
revoke all on function public.is_aquasense_admin() from public;
grant execute on function public.is_aquasense_admin() to authenticated, anon;
revoke all on function public.is_aquasense_owner_session() from public;
grant execute on function public.is_aquasense_owner_session() to authenticated, anon;

-- Serialize administrator removals so two concurrent requests cannot both
-- observe the same final-admin count and remove separate accounts.
create or replace function public.remove_aquasense_admin(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare active_admin_count integer;
begin
  perform pg_advisory_xact_lock(8447, 2204);
  select count(*) into active_admin_count
  from public.aquasense_admins a
  join auth.users u on u.id = a.user_id
  where u.banned_until is null or u.banned_until <= now();
  if active_admin_count <= 1 then return false; end if;
  delete from public.aquasense_admins where user_id = target_user_id;
  return found;
end;
$$;
revoke all on function public.remove_aquasense_admin(uuid) from public, anon, authenticated;
grant execute on function public.remove_aquasense_admin(uuid) to service_role;

-- Establish the required policy baseline even when an earlier deployment used
-- different policy names (or had no policies). Removing existing policies on
-- this allowlist is safe because the restrictive owner fence below is
-- recreated here, and service_role bypasses RLS for trusted server functions.
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'aquasense_admins'
  loop
    execute format('drop policy %I on public.aquasense_admins', p.policyname);
  end loop;
end $$;

alter table public.aquasense_admins enable row level security;
create policy "Membership fence" on public.aquasense_admins
  as restrictive for all to authenticated
  using (user_id = auth.uid() and public.is_aquasense_account_active())
  with check (user_id = auth.uid() and public.is_aquasense_account_active());
create policy "Users may verify their own administrator membership" on public.aquasense_admins
  for select to authenticated
  using (user_id = auth.uid() and public.is_aquasense_account_active());

revoke all on public.aquasense_admins from public, anon, authenticated;
grant select on public.aquasense_admins to authenticated;
