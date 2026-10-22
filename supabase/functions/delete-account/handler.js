const MAX_BODY_BYTES = 2048;
const RECENT_AUTH_SECONDS = 15 * 60;

function concatenate(chunks, byteLength) {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function jwtPayload(token) {
  try {
    const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!encoded) return null;
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch { return null; }
}

export function createDeleteAccountHandler({ env, createClient, now = () => Date.now(), logger = console }) {
  return async request => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response('ok', { headers });
    if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405, headers);

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json({ success: false, error: 'Request is too large.' }, 413, headers);
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ success: false, error: 'Sign in again to request account deletion.' }, 401, headers);
    const config = env();
    if (!config.url || !config.anonKey || !config.serviceRoleKey) return json({ success: false, error: 'Account deletion is not configured.' }, 503, headers);

    let body;
    try {
      if (!request.body) return json({ success: false, error: 'Request must contain valid JSON.' }, 400, headers);
      const reader = request.body.getReader();
      const chunks = [];
      let byteLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_BODY_BYTES) {
          await reader.cancel();
          return json({ success: false, error: 'Request is too large.' }, 413, headers);
        }
        chunks.push(value);
      }
      const raw = new TextDecoder().decode(concatenate(chunks, byteLength));
      body = JSON.parse(raw);
    } catch { return json({ success: false, error: 'Request must contain valid JSON.' }, 400, headers); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.confirmation_email !== 'string' || body.confirmation_email.length > 320) {
      return json({ success: false, error: 'Confirm the account email address.' }, 400, headers);
    }

    let user;
    try {
      const authClient = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: authData, error: authError } = await authClient.auth.getUser(token);
      user = authData?.user;
      if (authError || !user || !user.email) return json({ success: false, error: 'Your session could not be verified. Sign in again.' }, 401, headers);
    } catch (error) {
      logger.error('Account deletion session verification failed.', { code: error?.code || 'unknown' });
      return json({ success: false, error: 'Could not verify your session. Please try again.' }, 503, headers);
    }
    const issuedAt = Number(jwtPayload(token)?.auth_time);
    const ageSeconds = now() / 1000 - issuedAt;
    if (!Number.isFinite(issuedAt) || ageSeconds < -60 || ageSeconds > RECENT_AUTH_SECONDS) {
      return json({ success: false, error: 'For security, sign in again and retry account deletion.' }, 401, headers);
    }
    if (user.email.toLowerCase() !== body.confirmation_email.trim().toLowerCase()) {
      return json({ success: false, error: 'The confirmation email does not match the signed-in account.' }, 400, headers);
    }
    if (user.banned_until && Date.parse(user.banned_until) > now()) return json({ success: false, error: 'This account is suspended.' }, 403, headers);

    const service = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let membership;
    try {
      const result = await service.from('aquasense_admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (result.error) throw result.error;
      membership = result.data;
    } catch (error) {
      logger.error('Account deletion administrator check failed.', { code: error?.code || 'unknown' });
      return json({ success: false, error: 'Could not verify that this account is eligible for self-service deletion.' }, 500, headers);
    }
    if (membership) return json({ success: false, error: 'Administrator accounts cannot be deleted through user settings.' }, 403, headers);

    try {
      const { error } = await service.rpc('delete_aquasense_user_aquariums', { target_user_id: user.id });
      if (error) throw error;
    } catch (error) {
      logger.error('Account deletion aquarium cleanup failed.', { code: error?.code || 'unknown' });
      return json({ success: false, error: 'Account data could not be safely removed. No account deletion was completed; contact the administrator for review.' }, 500, headers);
    }

    try {
      const { error } = await service.auth.admin.deleteUser(user.id);
      if (error) throw error;
    } catch (error) {
      logger.error('Account deletion Auth operation failed after data cleanup.', { code: error?.code || 'unknown' });
      return json({ success: false, error: 'Aquarium data was removed, but account closure did not finish. Retry from this signed-in session to complete deletion.' }, 503, headers);
    }
    return json({ success: true, message: 'Account and owned aquarium data deleted.' }, 200, headers);
  };
}
