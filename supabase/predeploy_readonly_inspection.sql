-- AquaSense migration preflight inspection.
-- Read-only: this script begins a READ ONLY transaction and rolls it back.
-- It inspects catalog metadata only. It never selects application rows,
-- device-key hashes, tokens, or other credential values.

begin read only;

-- 1. Required objects and their RLS state.
with expected(table_name) as (
  values ('aquariums'), ('sensor_readings'), ('aquarium_settings'),
         ('aquarium_alerts'), ('aquarium_care_tasks'),
         ('aquarium_health_reports'), ('aquasense_admins'), ('aquasense_devices')
)
select e.table_name,
       (c.oid is not null) as exists,
       c.relkind as relation_kind,
       coalesce(c.relrowsecurity, false) as rls_enabled,
       coalesce(c.relforcerowsecurity, false) as rls_forced,
       pg_get_userbyid(c.relowner) as owner_role
from expected e
left join pg_namespace n on n.nspname = 'public'
left join pg_class c on c.relnamespace = n.oid and c.relname = e.table_name
order by e.table_name;

-- 2. Column metadata (no data values or column defaults).
select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, character_maximum_length, numeric_precision,
       numeric_scale, (column_default is not null) as has_default,
       is_identity, identity_generation, is_generated
from information_schema.columns
where table_schema = 'public'
  and table_name in ('aquariums', 'sensor_readings', 'aquarium_settings',
                     'aquarium_alerts', 'aquarium_care_tasks',
                     'aquarium_health_reports', 'aquasense_admins', 'aquasense_devices')
order by table_name, ordinal_position;

-- 3. Constraints, including primary/unique keys, FKs, and checks.
select ns.nspname as schema_name, tbl.relname as table_name,
       con.conname as constraint_name,
       case con.contype when 'p' then 'PRIMARY KEY' when 'u' then 'UNIQUE'
            when 'f' then 'FOREIGN KEY' when 'c' then 'CHECK' when 'x' then 'EXCLUSION'
            else con.contype::text end as constraint_type,
       pg_get_constraintdef(con.oid, true) as definition,
       con.convalidated as validated
from pg_constraint con
join pg_class tbl on tbl.oid = con.conrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname = 'public'
  and tbl.relname in ('aquariums', 'sensor_readings', 'aquarium_settings',
                      'aquarium_alerts', 'aquarium_care_tasks',
                      'aquarium_health_reports', 'aquasense_admins', 'aquasense_devices')
order by tbl.relname, con.conname;

-- 4. Index definitions (metadata only).
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('aquariums', 'sensor_readings', 'aquarium_settings',
                    'aquarium_alerts', 'aquarium_care_tasks',
                    'aquarium_health_reports', 'aquasense_admins', 'aquasense_devices')
order by tablename, indexname;

-- 5. Installed row-security policies and their expressions.
select schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('aquariums', 'sensor_readings', 'aquarium_settings',
                    'aquarium_alerts', 'aquarium_care_tasks',
                    'aquarium_health_reports', 'aquasense_admins', 'aquasense_devices')
order by tablename, policyname;

-- 6. Direct ACL entries, including PUBLIC grants. This returns privilege
-- metadata only; it does not expose rows or credential digests.
select table_schema, table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('aquariums', 'sensor_readings', 'aquarium_settings',
                     'aquarium_alerts', 'aquarium_care_tasks',
                     'aquarium_health_reports', 'aquasense_admins', 'aquasense_devices')
order by table_name, grantee, privilege_type;

-- 7. Effective table privileges for API/service roles (includes inherited
-- membership and PUBLIC privileges where PostgreSQL resolves them).
select c.relname as table_name, r.rolname as role_name,
       has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as can_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r
where n.nspname = 'public'
  and c.relname in ('aquariums', 'sensor_readings', 'aquarium_settings',
                    'aquarium_alerts', 'aquarium_care_tasks',
                    'aquarium_health_reports', 'aquasense_admins', 'aquasense_devices')
  and r.rolname in ('anon', 'authenticated', 'service_role')
order by c.relname, r.rolname;

-- 8. Serial/identity sequence used by sensor_readings.id, if one exists, and
-- effective sequence privileges needed by server-side inserts.
with reading_sequence as (
  select case when exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sensor_readings' and column_name='id'
  ) then pg_get_serial_sequence('public.sensor_readings', 'id') end as sequence_name
)
select sequence_name,
       has_sequence_privilege('anon', sequence_name, 'USAGE') as anon_can_use,
       has_sequence_privilege('authenticated', sequence_name, 'USAGE') as authenticated_can_use,
       has_sequence_privilege('service_role', sequence_name, 'USAGE') as service_role_can_use
from reading_sequence;

-- 9. Role attributes and memberships relevant to RLS/privilege inheritance.
select rolname, rolinherit, rolbypassrls, rolsuper
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres')
order by rolname;

select member.rolname as member_role, granted.rolname as granted_role,
       m.admin_option
from pg_auth_members m
join pg_roles granted on granted.oid = m.roleid
join pg_roles member on member.oid = m.member
where member.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
   or granted.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
order by member_role, granted_role;

-- 10. Relevant function existence, security mode, search_path and effective
-- execute privileges. Function source and secrets are intentionally omitted.
select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       p.proconfig as function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('owns_aquarium', 'is_aquasense_admin');

rollback;
