import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createIngestHandler } from '../supabase/functions/ingest-reading/handler.js';

const key = 'a'.repeat(48);
const registeredDevice = {
  device_id: 'tank-device-1', aquarium_id: '1', is_active: true,
  temperature_min: 18, temperature_max: 30, ph_min: 6, ph_max: 8.5,
};
const validBody = { aquarium_id: 1, temperature: 25.4, ph_level: 7.2, device_id: 'tank-device-1' };

function setup(overrides = {}) {
  const calls = { find: 0, rate: 0, inserts: [], logs: [], events: [] };
  const handler = createIngestHandler({
    env: () => ({ supabaseUrl: 'configured', serviceRoleKey: 'server-only', ingestPepper: 'p'.repeat(48), minimumIntervalMs: '1000' }),
    hashDeviceKey: async value => `hash:${value}`,
    findDevice: async hash => { calls.find++; if (overrides.findDeviceError) throw { code: 'DBERR', message: 'should not be returned' }; return hash === `hash:${key}` ? (overrides.device ?? registeredDevice) : null; },
    consumeRateLimit: async () => { calls.rate++; if (overrides.rateError) throw { code: 'RATEERR' }; return overrides.rateAllowed ?? true; },
    insertReading: async row => { calls.inserts.push(row); if (overrides.insertError) throw { code: 'INSERTERR', message: 'secret-bearing detail' }; return { id: 9, ...row, created_at: '2026-10-22T00:00:00Z' }; },
    logEvent: async event => calls.events.push(event),
    now: () => 10000,
    logger: { error: (...args) => calls.logs.push(args) },
  });
  return { handler, calls };
}

function request({ body = validBody, keyHeader = key, rawBody, method = 'POST' } = {}) {
  const headers = new Headers();
  if (keyHeader !== null) headers.set('x-device-key', keyHeader);
  if (rawBody !== undefined) headers.set('content-type', 'application/json');
  else if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request('https://example.invalid/functions/v1/ingest-reading', {
    method,
    headers,
    body: method === 'POST' ? (rawBody ?? JSON.stringify(body)) : undefined,
  });
}

async function result(response) { return { status: response.status, body: await response.json() }; }

test('rejects missing and unregistered device credentials without touching readings', async () => {
  const { handler, calls } = setup();
  assert.equal((await result(await handler(request({ keyHeader: null })))).status, 401);
  assert.equal((await result(await handler(request({ keyHeader: 'z'.repeat(48) })))).status, 401);
  assert.equal(calls.inserts.length, 0);
});

test('rejects malformed JSON and request bodies over the size limit', async () => {
  const { handler, calls } = setup();
  assert.equal((await result(await handler(request({ rawBody: '{not json' })))).status, 400);
  assert.equal((await result(await handler(request({ rawBody: ' '.repeat(4097) })))).status, 413);
  assert.equal(calls.inserts.length, 0);
});

test('rejects invalid aquarium IDs, missing or non-finite values, empty device IDs and out-of-range readings', async () => {
  const cases = [
    [{ ...validBody, aquarium_id: 0 }],
    [{ ...validBody, aquarium_id: ' ' }],
    [{ aquarium_id: 1, ph_level: 7 }],
    [{ ...validBody, temperature: '25' }],
    [{ ...validBody, temperature: null }],
    [{ ...validBody, ph_level: 7.2, temperature: 100 }],
    [{ ...validBody, ph_level: 9 }],
    [{ ...validBody, device_id: '' }],
  ];
  const { handler, calls } = setup();
  for (const [body] of cases) assert.equal((await result(await handler(request({ body })))).status, 400);
  assert.equal(calls.inserts.length, 0);
});

test('rejects attempts to submit another aquarium or spoof the registered device ID', async () => {
  const { handler, calls } = setup();
  assert.equal((await result(await handler(request({ body: { ...validBody, aquarium_id: 2 } })))).status, 403);
  assert.equal((await result(await handler(request({ body: { ...validBody, device_id: 'other-device' } })))).status, 403);
  assert.equal(calls.inserts.length, 0);
  assert.deepEqual(calls.events.map(event => event.event_code), ['aquarium_mismatch', 'aquarium_mismatch']);
  assert.ok(calls.events.every(event => event.aquarium_id === '1' && !('payload' in event) && !('device_key' in event)));
});

test('applies the atomic per-device rate limit and returns 429 when exhausted', async () => {
  const { handler, calls } = setup({ rateAllowed: false });
  assert.equal((await result(await handler(request()))).status, 429);
  assert.equal(calls.inserts.length, 0);
});

test('returns generic errors and logs only safe database metadata on lookup and insert failures', async () => {
  const lookup = setup({ findDeviceError: true });
  const lookupResponse = await result(await lookup.handler(request()));
  assert.equal(lookupResponse.status, 500);
  assert.doesNotMatch(JSON.stringify(lookupResponse.body), /secret-bearing|DBERR/);
  const inserted = setup({ insertError: true });
  const insertResponse = await result(await inserted.handler(request()));
  assert.equal(insertResponse.status, 500);
  assert.doesNotMatch(JSON.stringify(insertResponse.body), /secret-bearing|INSERTERR/);
  assert.equal(inserted.calls.logs[0][1].code, 'INSERTERR');
  assert.equal(inserted.calls.events[0].event_code, 'database_insert_failed');
});

test('inserts only the registered aquarium/device identity and preserves the successful response shape', async () => {
  const { handler, calls } = setup();
  const response = await result(await handler(request()));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.inserts[0], { aquarium_id: '1', temperature: 25.4, ph_level: 7.2, device_id: 'tank-device-1', source: 'esp32' });
  assert.deepEqual(Object.keys(response.body), ['success', 'message', 'reading']);
  assert.equal(response.body.success, true);
  assert.equal(response.body.reading.source, 'esp32');
  assert.deepEqual(calls.events, [{ device_id: 'tank-device-1', aquarium_id: '1', event_code: 'reading_accepted', outcome: 'success' }]);
});

test('migration keeps device credentials private and preserves owner-fenced client reading writes', async () => {
  const migration = await readFile(new URL('../supabase/migrations/202610220002_secure_device_ingestion.sql', import.meta.url), 'utf8');
  const ownership = await readFile(new URL('../supabase/migrations/202610220001_user_roles_and_aquarium_ownership.sql', import.meta.url), 'utf8');
  assert.match(migration, /device_key_hash text not null unique/i);
  assert.match(migration, /references public\.aquariums\(id\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.aquasense_devices from public, anon, authenticated/i);
  assert.match(migration, /grant select, update on public\.aquasense_devices to service_role/i);
  assert.match(ownership, /revoke insert, update, delete on public\.sensor_readings from anon, authenticated/i);
  assert.match(ownership, /public\.owns_aquarium\(aquarium_id\)/i);
});

test('Supabase gateway JWT verification is disabled only for the independently device-authenticated route', async () => {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.ingest-reading\]/);
  assert.match(config, /verify_jwt\s*=\s*false/);
});
