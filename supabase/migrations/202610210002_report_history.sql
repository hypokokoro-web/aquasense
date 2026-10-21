alter table public.aquarium_health_reports
  add column if not exists deleted_at timestamptz;

create index if not exists aquarium_health_reports_aquarium_deleted_created_idx
  on public.aquarium_health_reports (aquarium_id, deleted_at, created_at desc);

grant update on public.aquarium_health_reports to authenticated;

notify pgrst, 'reload schema';
