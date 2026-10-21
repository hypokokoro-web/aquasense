-- Persistent data for anomaly review, care planning, and generated reports.

create or replace function public.is_aquasense_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.aquasense_admins a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_aquasense_admin() from public;
grant execute on function public.is_aquasense_admin() to authenticated;

create table if not exists public.aquarium_alerts (
  id uuid primary key default gen_random_uuid(),
  aquarium_id bigint not null references public.aquariums(id) on delete cascade,
  fingerprint text not null,
  alert_type text not null,
  severity text not null check (severity in ('warning', 'critical')),
  message text not null,
  source_reading_id bigint references public.sensor_readings(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'acknowledged', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (aquarium_id, fingerprint)
);

create index if not exists aquarium_alerts_aquarium_status_idx
  on public.aquarium_alerts (aquarium_id, status, created_at desc);

create table if not exists public.aquarium_care_tasks (
  id uuid primary key default gen_random_uuid(),
  aquarium_id bigint not null references public.aquariums(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  notes text,
  task_type text not null default 'maintenance' check (task_type in ('feeding', 'maintenance', 'water_test', 'other')),
  due_at timestamptz not null,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aquarium_care_tasks_aquarium_due_idx
  on public.aquarium_care_tasks (aquarium_id, due_at);

create table if not exists public.aquarium_health_reports (
  id uuid primary key default gen_random_uuid(),
  aquarium_id bigint not null references public.aquariums(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  period_start timestamptz not null,
  period_end timestamptz not null,
  reading_count integer not null default 0 check (reading_count >= 0),
  report_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_start <= period_end)
);

create index if not exists aquarium_health_reports_aquarium_created_idx
  on public.aquarium_health_reports (aquarium_id, created_at desc);

alter table public.aquarium_alerts enable row level security;
alter table public.aquarium_care_tasks enable row level security;
alter table public.aquarium_health_reports enable row level security;

drop policy if exists "Aquasense admins manage aquarium alerts" on public.aquarium_alerts;
create policy "Aquasense admins manage aquarium alerts"
  on public.aquarium_alerts for all to authenticated
  using (public.is_aquasense_admin())
  with check (public.is_aquasense_admin());

drop policy if exists "Aquasense admins manage care tasks" on public.aquarium_care_tasks;
create policy "Aquasense admins manage care tasks"
  on public.aquarium_care_tasks for all to authenticated
  using (public.is_aquasense_admin())
  with check (public.is_aquasense_admin());

drop policy if exists "Aquasense admins manage health reports" on public.aquarium_health_reports;
create policy "Aquasense admins manage health reports"
  on public.aquarium_health_reports for all to authenticated
  using (public.is_aquasense_admin())
  with check (public.is_aquasense_admin());

grant select, insert, update, delete on public.aquarium_alerts to authenticated;
grant select, insert, update, delete on public.aquarium_care_tasks to authenticated;
grant select, insert, update, delete on public.aquarium_health_reports to authenticated;
