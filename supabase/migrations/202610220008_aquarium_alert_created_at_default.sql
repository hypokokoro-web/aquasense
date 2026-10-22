-- Ensure alert inserts that omit the audit timestamp remain valid on databases
-- where aquarium_alerts existed before the current module migration.
alter table public.aquarium_alerts
  alter column created_at set default now();

alter table public.aquarium_alerts
  alter column first_seen_at set default now(),
  alter column last_seen_at set default now();
