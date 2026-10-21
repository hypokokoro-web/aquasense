import { createClient } from 'npm:@supabase/supabase-js@2';
import { createIngestHandler } from './handler.js';

const encoder = new TextEncoder();
async function hashDeviceKey(deviceKey: string, pepper: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(deviceKey)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(createIngestHandler({
  env: () => ({
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    ingestPepper: Deno.env.get('AQUASENSE_INGEST_KEY'),
    minimumIntervalMs: Deno.env.get('AQUASENSE_INGEST_MIN_INTERVAL_MS'),
  }),
  hashDeviceKey,
  async findDevice(deviceKeyHash: string) {
    const { data, error } = await serviceClient().from('aquasense_devices')
      .select('device_id,aquarium_id,is_active,temperature_min,temperature_max,ph_min,ph_max')
      .eq('device_key_hash', deviceKeyHash).maybeSingle();
    if (error) throw error;
    return data;
  },
  async consumeRateLimit(deviceKeyHash: string, now: string, before: string) {
    const { data, error } = await serviceClient().from('aquasense_devices')
      .update({ last_request_at: now, last_seen_at: now })
      .eq('device_key_hash', deviceKeyHash).eq('is_active', true)
      .or(`last_request_at.is.null,last_request_at.lt.${before}`)
      .select('device_id').maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },
  async insertReading(row) {
    const { data, error } = await serviceClient().from('sensor_readings').insert(row)
      .select('id,aquarium_id,temperature,ph_level,source,device_id,created_at').single();
    if (error) throw error;
    return data;
  },
  async logEvent(event) {
    const { error } = await serviceClient().from('aquasense_ingest_events').insert(event);
    if (error) throw error;
  },
}));
