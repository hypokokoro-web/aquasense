-- Private device registry for ingest-reading. Device credentials are HMAC
-- digests, never plaintext. Device-to-aquarium authorization is server-side.
-- Requires the existing base aquariums and sensor_readings schema.

do $$
declare aquarium_id_type oid; reading_aquarium_id_type oid;
begin
  select a.atttypid into aquarium_id_type
  from pg_attribute a
  where a.attrelid = 'public.aquariums'::regclass and a.attname = 'id' and not a.attisdropped;
  select a.atttypid into reading_aquarium_id_type
  from pg_attribute a
  where a.attrelid = 'public.sensor_readings'::regclass and a.attname = 'aquarium_id' and not a.attisdropped;
  if aquarium_id_type is null or aquarium_id_type <> 'bigint'::regtype then
    raise exception 'Expected public.aquariums.id to be bigint; inspect the live base schema before applying this migration.';
  end if;
  if reading_aquarium_id_type is null or reading_aquarium_id_type <> aquarium_id_type then
    raise exception 'Expected public.sensor_readings.aquarium_id to match public.aquariums.id; inspect the live base schema before applying this migration.';
  end if;
  if not exists (select 1 from pg_attribute where attrelid='public.sensor_readings'::regclass and attname='temperature' and not attisdropped)
    or not exists (select 1 from pg_attribute where attrelid='public.sensor_readings'::regclass and attname='ph_level' and not attisdropped)
    or not exists (select 1 from pg_attribute where attrelid='public.sensor_readings'::regclass and attname='device_id' and not attisdropped)
    or not exists (select 1 from pg_attribute where attrelid='public.sensor_readings'::regclass and attname='source' and not attisdropped) then
    raise exception 'Expected temperature, ph_level, device_id and source columns on public.sensor_readings; inspect the live base schema before applying this migration.';
  end if;
  if exists (
    select 1 from pg_attribute a join pg_type t on t.oid=a.atttypid
    where a.attrelid='public.sensor_readings'::regclass and a.attname in ('temperature','ph_level')
      and not a.attisdropped and t.typcategory <> 'N'
  ) then
    raise exception 'Expected numeric temperature and ph_level columns on public.sensor_readings; inspect the live base schema before applying this migration.';
  end if;
  if exists (
    select 1 from pg_attribute a join pg_type t on t.oid=a.atttypid
    where a.attrelid='public.sensor_readings'::regclass and a.attname in ('device_id','source')
      and not a.attisdropped and t.typcategory <> 'S'
  ) then
    raise exception 'Expected text-compatible device_id and source columns on public.sensor_readings; inspect the live base schema before applying this migration.';
  end if;
  if not exists (select 1 from pg_attribute where attrelid='public.sensor_readings'::regclass and attname='id' and not attisdropped)
    or not exists (select 1 from pg_attribute where attrelid='public.sensor_readings'::regclass and attname='created_at' and not attisdropped) then
    raise exception 'Expected id and created_at columns on public.sensor_readings; inspect the live base schema before applying this migration.';
  end if;
end $$;

create table public.aquasense_devices (
  device_id text primary key check (length(trim(device_id)) between 1 and 128),
  aquarium_id bigint not null references public.aquariums(id) on delete cascade,
  device_key_hash text not null unique check (device_key_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  temperature_min numeric not null default 0,
  temperature_max numeric not null default 50,
  ph_min numeric not null default 0,
  ph_max numeric not null default 14,
  last_request_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  check (temperature_min >= 0 and temperature_max <= 50 and temperature_min < temperature_max),
  check (ph_min >= 0 and ph_max <= 14 and ph_min < ph_max)
);

create index if not exists aquasense_devices_aquarium_id_idx on public.aquasense_devices(aquarium_id);
alter table public.aquasense_devices enable row level security;
revoke all on public.aquasense_devices from public, anon, authenticated;
grant select, update on public.aquasense_devices to service_role;
