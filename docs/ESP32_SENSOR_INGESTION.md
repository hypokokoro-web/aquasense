# ESP32 sensor ingestion

## What is implemented

`POST /functions/v1/ingest-reading` accepts a JSON object with `aquarium_id`, finite numeric `temperature` and `ph_level`, and optional `device_id`. It returns HTTP 200 with `{ "success": true, "message": "Reading stored.", "reading": ... }` on success. This contract follows the supplied integration description; the checkout contains no firmware or prior ingestion function, so the deployed ESP32's response handling and exact current request headers remain unverified.

Each device must have a unique 32–256 character random key in `x-device-key`. The registry stores only an HMAC-SHA-256 digest keyed by `AQUASENSE_INGEST_KEY`; the firmware holds its device-specific key, never the pepper or Supabase service-role key. The request's `aquarium_id` must match the registered mapping. If `device_id` is supplied, it must exactly match the registered device ID; the database insert always uses the registered ID and sets `source` to `esp32`.

The function accepts limits per registered device. Defaults are 0–50 °C and pH 0–14; these are broad plausibility bounds, not care recommendations. Configure narrower validated bounds for each aquarium/device to match its sensor and intended use. Invalid values are rejected, not clamped. The request body is limited to 4 KiB.

An atomic registry update enforces one accepted request per device per interval, default 1,000 ms (`AQUASENSE_INGEST_MIN_INTERVAL_MS`, allowed 0–60,000). This limits request frequency by authenticated device. It does **not** provide replay protection: the current described payload has no timestamp, nonce or signature. A captured valid request can be replayed after the interval. If replay prevention is required, update firmware to send a signed timestamp and unique nonce/request ID, then validate freshness and persist nonce uniqueness server-side.

## Database and function prerequisites

1. Review the live base schema before applying migrations. The additive migration `supabase/migrations/202610220002_secure_device_ingestion.sql` checks for bigint `aquariums.id`, a matching `sensor_readings.aquarium_id`, numeric `temperature` and `ph_level`, text-compatible `device_id` and `source`, and `id`/`created_at` columns. It creates `aquasense_devices` with no client grants and maps each device to one aquarium. Apply after the ownership migration in a staging database first. The repository does not include the base schema or live Supabase metadata.
2. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Supabase Edge Function runtime secrets. Supabase provides these standard values; never put the service-role key in firmware, frontend variables, documentation, logs, or device registration output.
3. Set `AQUASENSE_INGEST_KEY` to a randomly generated server-side pepper of at least 32 characters. Keep it stable while registered device hashes depend on it. Since raw per-device keys are not stored, pepper rotation requires securely provisioning new per-device keys and replacing each registry digest in a coordinated maintenance window.
4. Optionally set `AQUASENSE_INGEST_MIN_INTERVAL_MS`; default is 1000. Do not set it to zero for production.
5. `supabase/config.toml` disables gateway JWT verification only for this function because the device uses `x-device-key`. The function performs device authentication itself before service-role access. Device HTTP clients also need the project's **publishable/anon API key** in the `apikey` header if required by the Supabase gateway. That key is not an authorization credential and does not replace `x-device-key`. Never send an `Authorization` bearer service-role token.
6. Deploy after review with `supabase functions deploy ingest-reading --project-ref <project-ref>`. Do not use `--no-verify-jwt` for other functions.

Because the function endpoint is unauthenticated at the gateway layer, production must also have an edge/gateway rule limiting unauthenticated traffic by source IP and request volume (or place it behind a rate-limiting proxy). Per-device rate limits do not stop invalid-key traffic from repeatedly reaching the function. Validate the provider's current capabilities and configure this before public exposure.

## Registering a device

Registration is a trusted operator action in SQL Editor, not a browser operation. First verify the actual aquarium ID and select valid per-device measurement limits. Generate a separate high-entropy key for each device; keep the raw value only in the secure provisioning process and device firmware. Set `AQUASENSE_DEVICE_KEY` transiently in a trusted operator environment, alongside the same `AQUASENSE_INGEST_KEY` pepper used by the function, then run:

```powershell
node scripts/device-key-hash.mjs
```

The script prints only the HMAC digest. Insert that digest with the reviewed device ID, aquarium ID and limits in Supabase SQL Editor, for example:

```sql
insert into public.aquasense_devices
  (device_id, aquarium_id, device_key_hash, temperature_min, temperature_max, ph_min, ph_max)
values
  ('<reviewed-device-id>', <verified-aquarium-id>, '<64-character-hmac-digest>', 18, 30, 6, 8.5);
```

The placeholders above are not credentials. Do not put the raw device key or pepper in SQL, shell history, source control, or support logs. The registry has no `anon` or `authenticated` access. To revoke a device, run a trusted operator update setting `is_active = false`; rotate by securely provisioning a new key and replacing its digest.

## Firmware compatibility and required change

The firmware source is absent from this repository. Before deployment, inspect its actual HTTP client for URL, method, required headers, payload serialization, timeout/retry behavior, and how it interprets non-2xx responses and JSON. Confirm it can add the Supabase project `apikey` header if required by the gateway and provision a unique device key in `x-device-key`. The four payload fields remain accepted, and `device_id` remains optional. The current payload's `aquarium_id` must equal the server-registered aquarium; changing it will return 403. If the firmware currently sends one shared key to all devices, provision unique per-device keys while retaining the same header name. Retry logic should treat 429 as a backoff response and avoid rapid retry loops.

The returned `reading` object contains `id`, `aquarium_id`, `temperature`, `ph_level`, `source`, `device_id`, and `created_at`, matching fields selected by the dashboard. Confirm any additional live columns have defaults or are nullable before deployment.

## Safe staging validation

1. Compare the migration preconditions with the live/staging schema and inspect existing grants, RLS and device policies. Confirm the ownership migration's client reading-write revocations are in place; this function writes with the server-side service-role client and does not weaken those policies.
2. Apply migrations only to staging, configure function secrets there, and register a test device against a test aquarium with appropriate ranges.
3. Test a valid request and check HTTP status, success JSON, Edge Function logs and the inserted row. Confirm the dashboard owner can read it and a different account cannot.
4. Test missing/invalid device key, malformed and oversized JSON, missing/non-finite values, range violations, a different aquarium ID, mismatched device ID, rate-limit response, and a simulated database failure.
5. Test the actual firmware's API-key header, timeout/retry behavior and response parsing against staging. Confirm no service-role credential is present in firmware or captured traffic.
6. Configure and test gateway/proxy IP rate limiting, then review logs for secret leakage and repeated invalid-key requests before production rollout.

No live migration, secret setup, function deployment, firmware modification, or database operation is performed by this repository change.
