const MAX_BODY_BYTES = 4096;
const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEVICE_KEY_MIN_LENGTH = 32;
const DEVICE_KEY_MAX_LENGTH = 256;

const response = (body, status, corsHeaders) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function normalizeAquariumId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) return null;
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)) return BigInt(value).toString();
  return null;
}

async function readBoundedBody(request) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { tooLarge: true };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch { return { malformed: true }; }
}

function parseReading(value, limits) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Request body must be a JSON object.' };
  const aquariumId = normalizeAquariumId(value.aquarium_id);
  if (!aquariumId) return { error: 'aquarium_id must be a positive integer.' };
  for (const field of ['temperature', 'ph_level']) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      return { error: `${field} must be a finite number.` };
    }
  }
  if (value.device_id !== undefined && (typeof value.device_id !== 'string' || !value.device_id.trim() || value.device_id.length > 128)) {
    return { error: 'device_id must be a non-empty string of at most 128 characters when provided.' };
  }
  if (limits && (value.temperature < limits.temperature_min || value.temperature > limits.temperature_max)) {
    return { error: 'temperature is outside the configured range for this device.' };
  }
  if (limits && (value.ph_level < limits.ph_min || value.ph_level > limits.ph_max)) {
    return { error: 'ph_level is outside the configured range for this device.' };
  }
  return { reading: { aquarium_id: aquariumId, temperature: value.temperature, ph_level: value.ph_level, submitted_device_id: value.device_id?.trim() } };
}

function validDeviceKey(key) {
  return typeof key === 'string' && key.length >= DEVICE_KEY_MIN_LENGTH && key.length <= DEVICE_KEY_MAX_LENGTH && !/[\r\n]/.test(key);
}

export function createIngestHandler({ env, hashDeviceKey, findDevice, consumeRateLimit, insertReading, logEvent, loadSettings, now = () => Date.now(), logger = console }) {
  return async request => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, x-device-key, apikey, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ success: false, message: 'Method not allowed.' }, 405, corsHeaders);

    const secrets = env();
    if (!secrets.supabaseUrl || !secrets.serviceRoleKey || !secrets.ingestPepper || secrets.ingestPepper.length < 32) {
      return response({ success: false, message: 'Reading ingestion is not configured.' }, 503, corsHeaders);
    }
    const deviceKey = request.headers.get('x-device-key');
    if (!validDeviceKey(deviceKey)) return response({ success: false, message: 'Invalid device credentials.' }, 401, corsHeaders);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
      return response({ success: false, message: 'Content-Type must be application/json.' }, 415, corsHeaders);
    }

    const bodyResult = await readBoundedBody(request);
    if (bodyResult.tooLarge) return response({ success: false, message: 'Request body is too large.' }, 413, corsHeaders);
    if (bodyResult.malformed) return response({ success: false, message: 'Request body is not valid UTF-8 JSON.' }, 400, corsHeaders);
    let body;
    try { body = JSON.parse(bodyResult.text); }
    catch { return response({ success: false, message: 'Request body must contain valid JSON.' }, 400, corsHeaders); }

    let keyHash;
    try { keyHash = await hashDeviceKey(deviceKey, secrets.ingestPepper); }
    catch (error) {
      logger.error('Reading ingestion credential hashing failed.', { name: error?.name || 'Error' });
      return response({ success: false, message: 'Reading ingestion is temporarily unavailable.' }, 500, corsHeaders);
    }
    let device;
    try { device = await findDevice(keyHash); }
    catch (error) {
      logger.error('Reading ingestion device lookup failed.', { code: error?.code || 'unknown' });
      return response({ success: false, message: 'Reading ingestion is temporarily unavailable.' }, 500, corsHeaders);
    }
    if (!device || device.is_active !== true) return response({ success: false, message: 'Invalid device credentials.' }, 401, corsHeaders);

    let platformSettings = {};
    try { if (loadSettings) platformSettings = await loadSettings(); }
    catch (error) {
      logger.error('Reading ingestion platform settings lookup failed.', { code: error?.code || 'unknown' });
      return response({ success: false, message: 'Reading ingestion is temporarily unavailable.' }, 503, corsHeaders);
    }

    const recordEvent = async (eventCode, outcome, aquariumId = device.aquarium_id) => {
      if (!logEvent) return;
      try { await logEvent({ device_id: device.device_id, aquarium_id: aquariumId, event_code: eventCode, outcome }); }
      catch (error) { logger.error('Reading ingestion diagnostic write failed.', { code: error?.code || 'unknown', event_code: eventCode }); }
    };

    const parsed = parseReading(body, null);
    if (parsed.error) {
      await recordEvent('invalid_payload', 'rejected');
      return response({ success: false, message: parsed.error }, 400, corsHeaders);
    }

    const globalLimits = {
      temperature_min: Number(platformSettings.esp32_temperature_min ?? 0),
      temperature_max: Number(platformSettings.esp32_temperature_max ?? 50),
      ph_min: Number(platformSettings.esp32_ph_min ?? 0),
      ph_max: Number(platformSettings.esp32_ph_max ?? 14),
    };
    if (!Object.values(globalLimits).every(Number.isFinite) || globalLimits.temperature_min < 0 || globalLimits.temperature_max > 50 || globalLimits.temperature_min >= globalLimits.temperature_max || globalLimits.ph_min < 0 || globalLimits.ph_max > 14 || globalLimits.ph_min >= globalLimits.ph_max) {
      logger.error('Reading ingestion has invalid platform measurement defaults.');
      return response({ success: false, message: 'Reading ingestion is not configured.' }, 503, corsHeaders);
    }
    const platformRangeCheck = parseReading(body, globalLimits);
    if (platformRangeCheck.error) {
      await recordEvent('measurement_out_of_range', 'rejected');
      return response({ success: false, message: platformRangeCheck.error }, 400, corsHeaders);
    }

    const registeredAquariumId = normalizeAquariumId(device.aquarium_id);
    if (!registeredAquariumId || registeredAquariumId !== parsed.reading.aquarium_id ||
        (parsed.reading.submitted_device_id && parsed.reading.submitted_device_id !== device.device_id)) {
      await recordEvent('aquarium_mismatch', 'rejected', registeredAquariumId);
      return response({ success: false, message: 'Device is not authorized for this aquarium.' }, 403, corsHeaders);
    }
    const limits = {
      temperature_min: Number(device.temperature_min), temperature_max: Number(device.temperature_max),
      ph_min: Number(device.ph_min), ph_max: Number(device.ph_max),
    };
    if (!Object.values(limits).every(Number.isFinite) || limits.temperature_min >= limits.temperature_max || limits.ph_min >= limits.ph_max) {
      logger.error('Reading ingestion device has invalid registered measurement limits.', { device_id: device.device_id });
      return response({ success: false, message: 'Reading ingestion is temporarily unavailable.' }, 500, corsHeaders);
    }
    const rangeCheck = parseReading(body, limits);
    if (rangeCheck.error) {
      await recordEvent('measurement_out_of_range', 'rejected', registeredAquariumId);
      return response({ success: false, message: rangeCheck.error }, 400, corsHeaders);
    }

    const timestamp = now();
    const minimumIntervalMs = Number(platformSettings.esp32_minimum_interval_ms ?? secrets.minimumIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    if (!Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 100 || minimumIntervalMs > 60000) {
      return response({ success: false, message: 'Reading ingestion is not configured.' }, 503, corsHeaders);
    }
    try {
      const allowed = await consumeRateLimit(keyHash, new Date(timestamp).toISOString(), new Date(timestamp - minimumIntervalMs).toISOString());
      if (!allowed) {
        await recordEvent('rate_limited', 'rejected', registeredAquariumId);
        return response({ success: false, message: 'Device request rate is too high.' }, 429, corsHeaders);
      }
    } catch (error) {
      logger.error('Reading ingestion rate check failed.', { code: error?.code || 'unknown' });
      return response({ success: false, message: 'Reading ingestion is temporarily unavailable.' }, 500, corsHeaders);
    }

    const row = { aquarium_id: registeredAquariumId, temperature: parsed.reading.temperature, ph_level: parsed.reading.ph_level, device_id: device.device_id, source: 'esp32' };
    try {
      const reading = await insertReading(row);
      await recordEvent('reading_accepted', 'success', registeredAquariumId);
      return response({ success: true, message: 'Reading stored.', reading }, 200, corsHeaders);
    } catch (error) {
      logger.error('Reading ingestion database insert failed.', { code: error?.code || 'unknown' });
      await recordEvent('database_insert_failed', 'error', registeredAquariumId);
      return response({ success: false, message: 'Could not store sensor reading.' }, 500, corsHeaders);
    }
  };
}
