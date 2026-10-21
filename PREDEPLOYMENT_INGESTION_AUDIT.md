# AquaSense final predeployment audit: ownership and ESP32 ingestion

**Scope and limits:** Read-only review of the named local migrations, function, key-hash tool, documentation, tests, and repository schema references. No live Supabase connection was made, no SQL was executed against a database, and no migration, function, credential, or configuration was changed. The only generated artifact alongside this report is `supabase/predeploy_readonly_inspection.sql`, which is a metadata-only read-only SQL script.

## Prioritized actions before staging or production

### P0 — close migration 001 inherited/anonymous privilege gaps

The ownership migration does not drop or fence old policies on `aquasense_admins` for `anon`; its membership fence and self-select policy apply only to `authenticated`. It also revokes sensor-reading writes from `anon` and `authenticated`, but not from PostgreSQL `PUBLIC`. If the base project has a `PUBLIC` or `anon` grant/policy, anon may still read allowlist rows or retain table privileges; a permissive legacy reading-write policy combined with a PUBLIC grant may permit writes that the migration intends to revoke. Actual grants/policies are unknown because the base schema is absent.

Before staging, inspect effective privileges and all current policies using the accompanying SQL script. Add a reviewed corrective migration that at minimum revokes all `aquasense_admins` privileges from `PUBLIC` and `anon`, then grants only authenticated SELECT; and revokes sensor-reading INSERT/UPDATE/DELETE from `PUBLIC`, `anon`, and `authenticated`. Confirm any legacy permissive policy cannot re-enable reading writes. Preserve the authenticated self-membership lookup. Do not assume a direct grant revocation removes a grant inherited through a custom role; inspect role memberships/effective ACLs too.

### P1 — make registry authorization and the reading insert one database transaction

The ingestion code correctly looks up the HMAC digest, requires an active device, checks the requested aquarium against the registered aquarium, checks an optional `device_id`, checks per-device measurement bounds, and constructs the inserted row from the registry identity (`aquarium_id`, `device_id`) plus validated measurements and fixed `source: "esp32"`. It uses `SUPABASE_SERVICE_ROLE_KEY` server-side and does not expose the key to clients.

However, registry lookup, atomic rate-limit update, and reading insert are three separate PostgREST requests. An operator changing a device's aquarium or measurement limits between lookup and insert can leave the request using stale authorization/limits. For a strict invariant, move the registry lock/check, rate-limit update, and `sensor_readings` insert into one narrowly scoped database function/transaction. Revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated`; grant it only to `service_role`. Return only the inserted reading fields. Review this change against the actual base schema before implementation.

### P1 — enforce a nonzero rate limit and protect the unauthenticated gateway route

The per-device rate-limit claim is concurrency-safe for requests against a stable registry row: the PostgREST PATCH is one conditional SQL UPDATE keyed by unique `device_key_hash`, guarded by `last_request_at IS NULL OR last_request_at < cutoff`. Concurrent updates to the same row serialize; after one changes the timestamp, a competing update rechecks the predicate and should return no row. The function treats that as HTTP 429. This conclusion is from the single conditional UPDATE pattern; the unit tests mock `consumeRateLimit` and do not prove this behavior against PostgreSQL/PostgREST.

`AQUASENSE_INGEST_MIN_INTERVAL_MS=0` is accepted and disables meaningful throttling. Reject zero for production (or enforce an operational minimum in configuration). The limiter applies only after valid device authentication, so requests with missing/random keys can still trigger body parsing and registry lookups. Configure and test gateway/proxy IP/request-volume limits before public exposure. The documented gateway rule is not implemented in these files.

### P1 — verify base schema and ownership mapping before applying migrations

Migration 002 fails early if the expected aquarium ID relationship or required column types do not match. This is a useful guard, not proof the hosted schema satisfies it. The repository contains no authoritative definitions for `aquariums`, `sensor_readings`, `aquarium_settings`, or `aquasense_admins`. Migration 001 also assumes those base tables and the `is_aquasense_admin()` function exist. It leaves `owner_id` null for old aquarium rows, so those rows remain stored but regular users will not see them until individually mapped. Build and verify the ownership map before enabling account access; never guess ownership.

### P1 — check actual firmware response/retry and gateway requirements

No ESP32 firmware is present. The request details below come from the user-provided contract, not repository verification. Confirm the deployed firmware's TLS validation, URL, headers, JSON encoding, HTTP status handling, retries/timeouts, and response parsing before staging. It must use a unique device key, respect the registered aquarium, send `Content-Type: application/json`, and add the Supabase publishable/anon `apikey` header if required by the project's gateway. It must never send a service-role key. Use backoff for 429 and transient 5xx/503 responses; treat malformed/configuration/authentication/authorization 4xx responses as requiring correction. Confirm it parses the 200 JSON `success` field.

### P2 — add replay protection if duplicate/replayed readings are unacceptable

There is no timestamp, nonce, signature, or idempotency key in the described payload or implementation. A captured valid static `x-device-key` request can be replayed after the rate window; the rate limit is not replay protection. If required, update firmware to sign a timestamp plus unique nonce/request ID with the per-device key, enforce a freshness window, and persist nonce uniqueness atomically with the insert.

## Detailed findings

### Migration order and dependencies

Expected sequence is existing base schema, feature migrations `202610210001`–`202610210005`, ownership migration `202610220001`, then registry migration `202610220002`. Migration `202610210001` creates alerts/tasks/reports but already references base `aquariums` and `sensor_readings`, and defines `is_aquasense_admin()` against the pre-existing allowlist. Migration 001 also assumes `aquarium_settings` and `aquasense_admins` exist. Migration 002 requires `aquariums` and `sensor_readings`; its FK is `aquasense_devices.aquarium_id → aquariums.id ON DELETE CASCADE`.

No SQL parser or live database was used, so syntax is reviewed statically only. The SQL constructs and PostgreSQL catalog checks look syntactically plausible. Migration 001 is not re-runnable as written: it creates policies without `DROP POLICY IF EXISTS`, although it uses `ADD COLUMN IF NOT EXISTS` and `CREATE OR REPLACE FUNCTION`. Migration 002 intentionally uses plain `CREATE TABLE`, so it fails if a table with that name already exists rather than silently reusing it. Run through the normal migration runner once, in staging first.

### Constraints, indexes and rollback

- Migration 001 adds nullable `owner_id` with `ON DELETE SET NULL` and an index. It does not backfill ownership. It creates owner/admin policies and restrictive fences for the listed tenant tables. It revokes reading writes only from `anon` and `authenticated` (see P0).
- Migration 002 constrains unique device IDs and HMAC hashes, active state, temperature range 0–50, pH range 0–14, and `min < max`; it indexes `aquarium_id`. Per-device defaults are broad plausibility bounds, not aquarium-care guidance. Registration sets actual device bounds.
- Registry FK `ON DELETE CASCADE` removes registrations if an aquarium is deleted. This is a data/operations choice to confirm. Removing the registry table in rollback loses device registrations and rate-limit timestamps, though not reading rows.
- There are no rollback scripts. Do not “roll back” by dropping `owner_id` or the registry blindly. Preserve ownership assignments, disable/revoke ingress deliberately, back up schema/data, and review rollback ordering (function first versus table) before rollout. Existing rows are not deleted by these migrations, but ownership loss on Auth-user deletion and device-registration cascade need operational consideration.

### Registry authorization, grants and secrets

The registry migration enables RLS, installs no client policy, revokes all table privileges from `PUBLIC`, `anon`, and `authenticated`, and grants only SELECT/UPDATE to `service_role`. Since it creates a new table with plain `CREATE TABLE`, pre-existing permissive registry policies cannot silently carry over. Service role is intentionally privileged and bypasses RLS; the registry is not safe from service-role compromise or database operators. The inspection script checks current policy state, ACLs, role attributes, and effective privileges without reading registry rows.

`scripts/device-key-hash.mjs` computes HMAC-SHA-256 using the raw per-device key as message and `AQUASENSE_INGEST_KEY` as pepper, printing only the digest. The Edge Function uses the same HMAC. The raw key and pepper are not logged by these files. The code performs a digest equality lookup in PostgreSQL rather than an application-level constant-time comparison; no constant-time guarantee is provided for indexed database equality. Since keys are expected to be unique, high-entropy random values and unknown/inactive keys share the same 401 body, this is not a direct plaintext comparison, but rate limiting and high-entropy provisioning remain important. Neither script nor function can prove that a chosen key has sufficient entropy; the operator workflow must generate one.

The device hash lookup is keyed by `device_key_hash`, protected by the server pepper and the hash is not selected into responses or logs. Registration is a privileged SQL Editor action; the documentation asks the operator to provide only the digest and a reviewed aquarium mapping. Pepper rotation requires reprovisioning keys because raw keys are not stored.

### Input handling and insert semantics

The handler requires POST, JSON content type, a 32–256 character device header, a JSON object, positive integer aquarium ID, finite numeric temperature and pH, and a nonempty optional device ID up to 128 characters. It caps the body at 4096 bytes, checks registered per-device bounds, and does not clamp values. Aquarium ID accepts a safe positive JSON integer or canonical digit string. It returns generic DB errors and logs only stage plus error code/name (and device ID for invalid registry bounds), not request headers, keys, or raw database messages.

Insert includes only `aquarium_id`, `temperature`, `ph_level`, registry `device_id`, and `source: "esp32"`, then selects `id`, `aquarium_id`, `temperature`, `ph_level`, `source`, `device_id`, and `created_at`. This matches the dashboard's selected reading fields and inferred migration reference to `sensor_readings.id` as bigint. Migration 002 checks key columns and broad type categories, but does not verify `device_id` maximum length, numeric precision/scale, defaults/nullability for all other required reading columns, or whether an `id`/`created_at` default exists. A live table with an additional NOT NULL/no-default column or a too-short `device_id` varchar can make insertion fail. Verify those details with the inspection script; add/adjust preflight checks only after confirming the intended schema.

### Firmware contract

**User-reported, not locally verified:** `POST /functions/v1/ingest-reading`, `x-device-key` header, JSON containing `aquarium_id` (currently stated as `1`), `temperature`, `ph_level`, and `device_id`. The body fields are accepted by the new local handler, but the aquarium value must match the registered device. No firmware confirms whether `device_id` is optional in deployed builds, whether request uses HTTPS/certificate validation, whether an API key header is supplied, which statuses are retried, or whether `success/message/reading` is parsed.

**Local implementation:** gateway JWT verification is disabled only for this function in `supabase/config.toml`; the handler does its own device-key check before service-role operations. Success is HTTP 200 with `success`, `message`, and `reading`. Error statuses include 400, 401, 403, 413, 415, 429, 500, and 503. The code allows the `apikey` header in CORS but does not itself require or validate it; whether the Supabase gateway requires it must be checked for the target project/client.

## Test coverage review

`tests/ingestReading.test.js` has unit tests for missing/unregistered keys, malformed/oversized body, invalid/missing/non-finite/out-of-range fields, aquarium/device mismatches, rate denial, generic lookup and insert errors, successful row construction/response shape, and static ownership/registry migration assertions. These tests inject fake registry/rate/insert adapters. They do not execute migration SQL, call a real Supabase/Postgres instance, test concurrent requests against PostgREST, test inactive-device revocation, test rate-check DB failure, exercise the real WebCrypto HMAC against the registration utility, or run the Edge Function on Deno. Existing tests also do not establish live RLS behavior.

No tests were run as part of this read-only review; coverage was inspected from source only.

## Required read-only inspection script

Run `supabase/predeploy_readonly_inspection.sql` in the target project's SQL Editor after reviewing it. It begins a `READ ONLY` transaction and rolls back at the end. It selects catalog metadata only: table/column definitions, constraints, indexes, RLS state and policies, ACL/effective privileges, role RLS attributes/memberships, and relevant function security metadata. It deliberately does not select application rows, device hashes, API keys, or secret values. Confirm the SQL Editor accepts the explicit read-only transaction syntax before relying on results; otherwise run its SELECT statements individually in read-only mode.

## Checklist

### Before staging

- [ ] Run the inspection script against a staging clone and compare all base columns, types, defaults/nullability, indexes, constraints, grants, policies, and role memberships.
- [ ] Resolve the P0 `aquasense_admins` anon/PUBLIC and `sensor_readings` PUBLIC grant gaps with a reviewed corrective migration; verify effective privileges after it.
- [ ] Confirm aquariums and existing readings remain intact and create a reviewed aquarium-to-user mapping; do not guess owner assignments.
- [ ] Confirm required target schema columns/defaults, `aquasense_admins` base policies, and function/migration ordering.
- [ ] Decide whether to replace the separate lookup/rate/insert calls with a single transaction/RPC and enforce a nonzero rate limit.
- [ ] Configure and verify gateway/proxy rate limiting for invalid-key traffic.
- [ ] Obtain the actual firmware source/build, confirm HTTPS certificate validation, request headers, status/retry logic, response parsing, and provision unique device keys. Confirm if API `apikey` is required.
- [ ] Register a staging device with a verified aquarium and realistic sensor-specific limits; confirm owner mapping is already assigned.
- [ ] Test successful ingestion, cross-aquarium denial, inactive key, boundary and invalid readings, simultaneous requests, rate responses, insert failure, owner/non-owner reads, and key revocation on staging.

### Before production

- [ ] Review staging results and migration/rollback plan with an operator; back up production.
- [ ] Apply only reviewed migrations through the approved migration process; do not use production SQL Editor for exploratory or mutating queries.
- [ ] Set the pepper and Supabase service credentials only in server-side function secrets; provision each device key securely and store only its digest in the private registry.
- [ ] Deploy `ingest-reading` only after the registry migration and staging tests pass; verify `verify_jwt=false` is limited to this route and device checks always run before service-role access.
- [ ] Send one real device reading; compare response, database row, owner visibility, and absence of non-owner visibility. Monitor generic error codes and edge/gateway rate limits without logging credentials.
- [ ] Decide and implement replay protection if duplicate replay risk is unacceptable; current implementation does not prevent replay after the interval.
