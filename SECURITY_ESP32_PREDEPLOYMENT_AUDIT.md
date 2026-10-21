# AquaSense pre-deployment security and ESP32 compatibility audit

**Scope:** Local repository inspection only. No hosted Supabase schema, policies, logs, firmware, or device requests were accessed. No migration or deployment was performed. Subsequent local work added a proposed secure ingestion function and registry migration; this report describes repository intent and cannot certify live behavior.

## Findings

### Table access rules

| Table | Repository migration rules / intended access | Risk or verification needed |
|---|---|---|
| `aquariums` | `owner_id` references `auth.users`; authenticated owners/admins read, update, delete; users insert rows only for themselves. A restrictive owner/admin fence also constrains existing permissive policies. | Existing rows receive `NULL` ownership. They remain in the database but regular accounts cannot see them until individually mapped. The current insert policy does not let an admin create an aquarium for another user. Confirm live ID type, grants, policies, and any legacy public access. |
| `sensor_readings` | Authenticated owners/admins read through `owns_aquarium`; client `INSERT`, `UPDATE`, and `DELETE` are revoked from `anon` and `authenticated`. Restrictive fence applies to these roles. Trusted `service_role` is expected to bypass RLS. | Direct ESP32 writes with anon/authenticated credentials will fail after this migration. No ingestion writer is present in this repository, so service-role compatibility is an assumption, not verified. |
| `aquarium_settings` | Authenticated owners/admins can read and manage records for their aquariums. | Confirm actual `aquarium_id` relationship, grants, and any unlisted legacy policies. |
| `aquarium_alerts` | Created by migration with an aquarium FK; authenticated owners/admins can manage own/authorized records; restrictive fence constrains legacy policies. | Client dashboard creates and updates alerts. Confirm live table matches the migration and check whether old policies/grants add access. |
| `aquarium_care_tasks` | Created with aquarium FK; authenticated owners/admins can manage authorized records; restrictive fence applies. | Same live-schema and legacy-policy checks. |
| `aquarium_health_reports` | Created with aquarium FK; authenticated owners/admins can manage authorized records; `deleted_at` added by the next migration. | Same checks; confirm `deleted_at` and all report columns exist live. |
| `aquasense_admins` | Ownership migration enables RLS, limits authenticated SELECT to the caller's own `user_id`, and revokes client writes. Admin mutation is performed by `aquasense-admin` using server-side service role. `is_aquasense_admin()` reads membership in a security-definer function. | The repository does not create this table or establish its primary/unique key or original policies. Verify it exists, `user_id` is UUID and unique, and no unexpected grants/policies remain. |
| `aquasense_knowledge_chunks` | RLS enabled; authenticated SELECT policy is admin-only; search RPC is security-invoker and executable by authenticated/service role. Assistant function uses service role for retrieval. | Confirm deployed table, grants and function match migrations; no aquarium ownership key on this global reference table. |
| `aquasense_devices` | Added by `202610220002_secure_device_ingestion.sql`; maps `device_id` and an HMAC digest to one aquarium, with per-device measurement limits. RLS is enabled and client roles receive no privileges; service role receives SELECT/UPDATE for authentication and rate tracking. | New additive migration is not applied. Apply only after verifying its base-schema preconditions in staging. Device registration is trusted-operator only. |
| Other aquarium-linked tables | No other such table is defined in the migrations found. | The base schema is absent. Inventory every live table with an aquarium/device FK, including any maintenance or device tables, and add owner/admin policies before release. |

Policies for the module tables were initially admin-only in earlier migrations; the ownership migration adds permissive owner policies plus restrictive fences for `anon`/`authenticated`. Restrictive policies combine with permissive policies, so they constrain legacy public policies for those roles. They do not protect against `service_role` or database owners. Confirm that no additional role, view, RPC, storage bucket, or security-definer function exposes tenant data.

### Role and privileged operations

- Signup does not accept a role. Browser role display is based on querying the caller's own `aquasense_admins` membership, and failed membership lookup signs the session out. UI route guards alone are not security boundaries.
- The `aquasense-admin` function verifies the bearer token with Supabase Auth, then checks the caller against `aquasense_admins` using a server-side service client before processing actions. It validates the target UUID and boolean, verifies target account existence, and uses Auth Admin / allowlist operations only after authorization. Browser code does not receive the service key.
- Client mutations to the allowlist are revoked by the ownership migration. Do not grant those rights to browser roles. Verify the live allowlist's uniqueness constraint because function `upsert(... onConflict: 'user_id')` relies on it.
- The function permits an authorized administrator to demote their own account. The UI disables that action, but the server does not. This is not privilege escalation; it can remove the last admin. Add a server-side last-admin/self-demotion guard if accidental lockout must be prevented.
- `src/lib/supabase.js` uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; frontend code has no service-role reference. `.env.local` was not read or printed. Confirm production build variables contain only publishable values; rotate any privileged key ever used in a browser or device.

## ESP32 path and migration compatibility

No ESP32 firmware is present, and no original ingestion function or device URL could be inspected. The dashboard and `aquasense-assistant` query readings; dashboard writes concern alerts, care tasks, reports, and settings. Local work has since added `supabase/functions/ingest-reading/index.ts` plus a handler: it accepts the described `aquarium_id`, `temperature`, `ph_level`, optional `device_id` body, checks `x-device-key` using HMAC with server-side `AQUASENSE_INGEST_KEY`, resolves the hash against the private device registry, enforces the registered aquarium and per-device bounds, then inserts `source: "esp32"` with the service-role client. Success returns `success`, `message`, and `reading`.

The deployed ESP32's current URL, headers, exact credential, response handling, and retry logic remain **unverified**. The newly added local route is `/functions/v1/ingest-reading`; it is not deployed or evidence of the route currently used by the device. Before migration, compare the firmware and Supabase project with the new documented contract:

1. In the firmware, identify the complete request URL/host, HTTP method, headers, credential type, JSON payload, target aquarium/device identifier, and retry behavior. Search all firmware branches and deployed build configuration.
2. In Supabase Dashboard, inspect Edge Functions and their source/configuration; check API/database logs for the actual sensor write requests and role used. Identify any external ingestion service as well.
3. In Table Editor / SQL Editor, inspect live `sensor_readings` grants, RLS state and every policy; confirm whether the writer role is `service_role`, a dedicated server role, or `anon`/`authenticated`.
4. Confirm the live base schema for `aquariums`, `sensor_readings`, `aquarium_settings`, `aquasense_admins`, and every aquarium-linked table, including column types, foreign keys, constraints, indexes, sequences and existing RLS policies.

If ESP32 currently writes with the anon key, migration revokes those writes and ingestion will stop. The local function writes with the service-role client and is designed to continue through the reading-table RLS restrictions; this is not verified against the live database. Do not preserve direct device writes by granting broad client insert access. The new route requires each device to use a unique key in `x-device-key`, a registry entry mapping that key to its aquarium, and the project's publishable/anon API key header if required by the Supabase gateway. Never embed the service-role key or `AQUASENSE_INGEST_KEY` pepper in firmware. Per-device interval limiting is implemented; replay protection is not, because the supplied payload has no timestamp/nonce/signature. Deployment-level IP/gateway rate limiting is also documented as required.

## Migration risks and required changes

1. **Do not apply until the live base schema is compared with these migrations.** The repository lacks the base table definitions and the `aquasense_admins` creation/policy migration. In particular, confirm `aquariums.id` and `sensor_readings.aquarium_id` are compatible with `bigint`, and all named tables/columns exist. The new ingestion migration checks expected reading columns and fails if key aquarium ID assumptions differ.
2. **Prepare an owner mapping before rollout.** `owner_id` is nullable and has no backfill. Existing records stay stored but become invisible to regular users until mapped. Use verified aquarium-to-Auth-user mappings from business records or operator confirmation; leave ambiguous rows unassigned. Never infer ownership or assign all rows to the first account.
3. **Resolve ingestion before rollout.** If the deployed writer uses a client role, deploy and validate a trusted ingestion endpoint first, then apply the read-only client policy. Do not weaken reading-table RLS to keep an unknown device path alive.
4. **Check policy/grant gaps.** Enumerate every aquarium-linked table and every policy/grant in the live project. Confirm existing permissive policies cannot expose rows through other roles or views. The migration fences only listed tables and only `anon`/`authenticated`.
5. **Consider administrative aquarium creation.** If administrators need to create aquariums for users, add a narrowly scoped admin insert policy with a verified owner UUID; current `Users create owned aquariums` check only accepts the caller's own UUID.
6. **Verify `aquasense_admins.user_id` unique/PK and policy baseline.** Required by admin upsert and membership lookup. No repository migration establishes this table.
7. The deployed route still must be identified. If it is direct client insertion, update firmware to call the new function and send a per-device credential before applying the ownership migration. The request body fields remain compatible, but a shared device key must be replaced with a unique key per device; confirm firmware handles the documented 200/400/401/403/413/429/500 responses and JSON body.

## Safe validation sequence

1. Export schema, grants, policies and row counts from the production project without modifying it. Compare them with the migration assumptions above; rehearse the migration and ownership mapping against a recent staging clone first.
2. Back up the database and record existing aquarium/readings counts and representative reading timestamps. Apply migrations only in staging first; verify counts and sample data remain intact.
3. In staging, test account A can list/read only its mapped aquarium, readings and linked records; account B cannot select or mutate A's records even by guessing IDs. Confirm each account can manage only its own permitted settings/alerts/tasks/reports.
4. Confirm neither account can insert/update/delete `sensor_readings` or insert/update/delete `aquasense_admins`; confirm the allowlisted admin can see the intended platform data and only the Edge Function can change admin membership.
5. Send a test sensor payload through the **verified production-equivalent device route**. Check HTTP response, function/database logs, resulting row, aquarium association and that owner account can read it. Confirm a non-owner cannot read it. Test invalid device credentials and malformed/out-of-range payloads are rejected.
6. Compare counts and latest timestamps before and after; test device offline/retry behavior and avoid replaying production payloads during validation.

## Deployment checklist

- [ ] Inspect and document the live schema, all RLS policies/grants, admin allowlist constraints, and every aquarium-linked table.
- [ ] Identify and test the real ESP32 ingestion route; establish a trusted server writer before applying reading-write revocations if devices currently write directly.
- [ ] Prepare and independently review the aquarium-to-Auth-user ownership mapping; resolve or explicitly leave ambiguous rows unassigned.
- [ ] Back up production and rehearse on staging; verify existing row counts and access behavior.
- [ ] Set Edge Function secrets in Supabase's server-side secret store; deploy `aquasense-admin` only after the schema and allowlist are confirmed. Never put service-role credentials in frontend variables or firmware.
- [ ] Verify the deployed function rejects unauthenticated and non-admin `list_users`/`set_admin` calls; verify an admin can grant/revoke a test account, and review last-admin lockout behavior.
- [ ] Test two separate accounts against aquariums, readings and each linked table, including guessed foreign aquarium IDs and attempted privilege writes.
- [ ] Test ingestion end-to-end using the actual device route, confirm the reading persists and is visible only to its owner/admin, and review logs for errors.
- [ ] Apply production migrations only after all checks pass; compare post-migration counts and latest sensor timestamps with the recorded baseline.

## Local verification

Local implementation tests and the production frontend build passed after adding the ingestion handler and documentation. The build reports the existing nonfatal large-chunk warning. These checks cannot validate Deno runtime deployment, hosted Supabase policies/schema, Edge Function secrets, or ESP32 behavior.
