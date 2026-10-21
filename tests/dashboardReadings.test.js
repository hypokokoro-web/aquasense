import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appPromise = readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('dashboard reports the RLS-visible aquarium being absent before reading queries', async () => {
  const app = await appPromise;
  assert.match(app, /if \(!tank\) \{[\s\S]*?setAquariumId\(null\); setReadings\(\[\]\); setHistoryReadings\(\[\]\);[\s\S]*?No aquarium is accessible to this account/);
  assert.match(app, /isSupabaseConfigured && connectionError[\s\S]*?role="alert"[\s\S]*?Could not load aquarium readings[\s\S]*?onClick=\{fetchReadings\}/);
});

test('dashboard reports an accessible aquarium with no visible sensor rows', async () => {
  const app = await appPromise;
  assert.match(app, /isSupabaseConfigured && !loading && !connectionError && aquariumId && readings\.length === 0/);
  assert.match(app, /No sensor readings were returned for aquarium \{aquariumId\}/);
});

test('dashboard selects the ingestion columns and polls without overlapping requests', async () => {
  const app = await appPromise;
  assert.match(app, /select\('id, aquarium_id, temperature, ph_level, source, device_id, created_at'\)/);
  assert.match(app, /const readingsRequestInFlight = useRef\(false\)/);
  assert.match(app, /if \(readingsRequestInFlight\.current\) return/);
  assert.match(app, /window\.setInterval\([\s\S]*?fetchReadings\(\)[\s\S]*?, 15000\)/);
});

