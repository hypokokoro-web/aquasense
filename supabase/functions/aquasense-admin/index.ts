import { createClient } from 'npm:@supabase/supabase-js@2';
import { hasPasswordAuthMethod } from '../_shared/auth-method.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = ['fish', 'water_quality', 'care', 'learning'] as const;
const ANNOUNCEMENT_CATEGORIES = ['general', 'maintenance', 'feature', 'important'] as const;

async function writeAudit(service: ReturnType<typeof createClient>, actorId: string, entry: {
  action: string; entity_type: string; entity_id?: string | null; outcome: 'success' | 'failure'; metadata?: Record<string, unknown>;
}) {
  const { error } = await service.from('aquasense_audit_logs').insert({ actor_id: actorId, ...entry, metadata: entry.metadata || {} });
  if (error) console.error('Admin audit record write failed.', { code: error.code || 'unknown', action: entry.action });
  return !error;
}

function validIsoOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: 'Sign in as an administrator.' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Admin service is not configured.' }, 503);

  const authClient = createClient(url, anonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return json({ error: 'Your session could not be verified.' }, 401);
  const service = createClient(url, serviceKey);
  const { data: admin, error: roleError } = await service.from('aquasense_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (roleError) return json({ error: 'Could not verify administrator access.' }, 500);

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Request must contain valid JSON.' }, 400); }
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return json({ error: 'This account is suspended.' }, 403);

  // Published notices are the only operation available to signed-in regular
  // accounts. All management and diagnostics require the allowlist + password.
  if (body.action === 'list_announcements') {
    const [{ data, error }, { data: platformSettings, error: settingsError }] = await Promise.all([
      service.from('aquasense_announcements')
      .select('id,title,message,category,publish_at,expires_at,updated_at')
      .eq('status', 'published').or(`publish_at.is.null,publish_at.lte.${new Date().toISOString()}`)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('publish_at', { ascending: false }).limit(20),
      service.from('aquasense_platform_settings').select('setting_key,setting_value').in('setting_key', ['maintenance_mode_enabled', 'maintenance_mode_message']),
    ]);
    if (error || settingsError) return json({ error: 'Could not load platform notices.' }, 503);
    const settings = Object.fromEntries((platformSettings || []).map(row => [row.setting_key, row.setting_value]));
    return json({ announcements: data || [], maintenance: {
      enabled: settings.maintenance_mode_enabled === true,
      message: typeof settings.maintenance_mode_message === 'string' ? settings.maintenance_mode_message : 'AquaSense is undergoing scheduled maintenance. Some features may be temporarily unavailable.',
    } });
  }
  if (!admin) return json({ error: 'Administrator access is required.' }, 403);
  if (!hasPasswordAuthMethod(token)) return json({ error: 'Administrator sign-in requires email and password.' }, 403);

  if (body.action === 'list_users') {
    const accounts = [];
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json({ error: 'Could not load account records.' }, 500);
      accounts.push(...data.users);
      if (data.users.length < 1000) break;
    }
    const { data: adminRows, error: adminsError } = await service.from('aquasense_admins').select('user_id');
    if (adminsError) return json({ error: 'Could not load administrator assignments.' }, 500);
    const adminIds = new Set((adminRows || []).map(row => row.user_id));
    const normalizedAccounts = accounts.map(account => ({
      id: account.id,
      email: account.email || null,
      email_verified: Boolean(account.email_confirmed_at),
      name: account.user_metadata?.full_name || account.user_metadata?.name || null,
      created_at: account.created_at,
      last_sign_in_at: account.last_sign_in_at || null,
      banned_until: account.banned_until || null,
      role: adminIds.has(account.id) ? 'admin' : 'user',
    }));
    const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().slice(0, 160) : '';
    const roleFilter = ['user', 'admin'].includes(String(body.role_filter)) ? String(body.role_filter) : 'all';
    const statusFilter = ['active', 'suspended'].includes(String(body.status_filter)) ? String(body.status_filter) : 'all';
    const filtered = normalizedAccounts.filter(account => {
      const suspended = Boolean(account.banned_until && Date.parse(account.banned_until) > Date.now());
      return (!search || `${account.email || ''} ${account.name || ''} ${account.id}`.toLowerCase().includes(search)) &&
        (roleFilter === 'all' || account.role === roleFilter) &&
        (statusFilter === 'all' || (statusFilter === 'suspended') === suspended);
    });
    const requestedPage = Number(body.page ?? 1);
    const accountPage = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, 100000)) : 1;
    return json({ users: filtered.slice((accountPage - 1) * 25, accountPage * 25), total: filtered.length, page: accountPage, page_size: 25 });
  }

  if (body.action === 'set_user_suspended') {
    if (typeof body.user_id !== 'string' || !UUID.test(body.user_id) || typeof body.suspended !== 'boolean') return json({ error: 'Provide a valid account ID and suspension state.' }, 400);
    if (body.user_id === user.id) {
      await writeAudit(service, user.id, { action: 'account_suspended', entity_type: 'user', entity_id: body.user_id, outcome: 'failure', metadata: { reason: 'self_suspension_blocked' } });
      return json({ error: 'You cannot suspend your own account.' }, 409);
    }
    const { data: target, error: targetError } = await service.auth.admin.getUserById(body.user_id);
    if (targetError || !target.user) return json({ error: 'Account not found.' }, 404);
    if (body.suspended) {
      const { data: targetAdmin, error: targetAdminError } = await service.from('aquasense_admins').select('user_id').eq('user_id', body.user_id).maybeSingle();
      if (targetAdminError) return json({ error: 'Could not verify target account access.' }, 500);
      if (targetAdmin) {
        await writeAudit(service, user.id, { action: 'account_suspended', entity_type: 'user', entity_id: body.user_id, outcome: 'failure', metadata: { reason: 'remove_admin_role_first' } });
        return json({ error: 'Remove administrator access before suspending this account.' }, 409);
      }
    }
    const { error } = await service.auth.admin.updateUserById(body.user_id, { ban_duration: body.suspended ? '876000h' : 'none' });
    if (error) {
      await writeAudit(service, user.id, { action: body.suspended ? 'account_suspended' : 'account_reactivated', entity_type: 'user', entity_id: body.user_id, outcome: 'failure' });
      return json({ error: 'Could not update account status.' }, 500);
    }
    await writeAudit(service, user.id, { action: body.suspended ? 'account_suspended' : 'account_reactivated', entity_type: 'user', entity_id: body.user_id, outcome: 'success' });
    return json({ ok: true });
  }

  if (body.action === 'revoke_user_sessions') {
    if (typeof body.user_id !== 'string' || !UUID.test(body.user_id)) return json({ error: 'Provide a valid account ID.' }, 400);
    if (body.user_id === user.id) return json({ error: 'You cannot revoke your current administrator session.' }, 409);
    const { data: target, error: targetError } = await service.auth.admin.getUserById(body.user_id);
    if (targetError || !target.user) return json({ error: 'Account not found.' }, 404);
    const { data: revokedCount, error } = await service.rpc('revoke_aquasense_user_sessions', { target_user_id: body.user_id });
    if (error) {
      await writeAudit(service, user.id, { action: 'sessions_revoked', entity_type: 'user', entity_id: body.user_id, outcome: 'failure' });
      console.error('Admin session revocation failed.', { code: error.code || 'unknown' });
      return json({ error: 'Could not revoke account sessions. Apply the account session migration first.' }, 503);
    }
    await writeAudit(service, user.id, { action: 'sessions_revoked', entity_type: 'user', entity_id: body.user_id, outcome: 'success', metadata: { refresh_sessions_revoked: revokedCount || 0 } });
    return json({ ok: true, revoked_sessions: revokedCount || 0 });
  }

  if (body.action === 'list_audit_logs') {
    const requestedLimit = Number(body.limit ?? 50);
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 100)) : 50;
    let query = service.from('aquasense_audit_logs').select('id,actor_id,action,entity_type,entity_id,outcome,metadata,created_at').order('created_at', { ascending: false }).limit(limit);
    if (typeof body.action_filter === 'string' && body.action_filter) query = query.eq('action', body.action_filter.slice(0, 80));
    if (typeof body.entity_type === 'string' && body.entity_type) query = query.eq('entity_type', body.entity_type.slice(0, 64));
    if (typeof body.actor_id === 'string' && body.actor_id && !UUID.test(body.actor_id)) return json({ error: 'Actor filter must be a valid account ID.' }, 400);
    if (typeof body.actor_id === 'string' && body.actor_id) query = query.eq('actor_id', body.actor_id);
    const from = validIsoOrNull(body.from), to = validIsoOrNull(body.to);
    if (from === undefined || to === undefined) return json({ error: 'Date filters must be valid timestamps.' }, 400);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    const { data, error } = await query;
    if (error) return json({ error: 'Could not load audit history.' }, 500);
    return json({ logs: data || [] });
  }

  if (body.action === 'list_operations') {
    const [devices, events, offlineTimeoutSetting] = await Promise.all([
      service.from('aquasense_devices').select('device_id,aquarium_id,is_active,last_request_at,last_seen_at').order('last_seen_at', { ascending: false, nullsFirst: false }).limit(100),
      service.from('aquasense_ingest_events').select('id,device_id,aquarium_id,event_code,outcome,created_at').order('created_at', { ascending: false }).limit(100),
      service.from('aquasense_platform_settings').select('setting_value').eq('setting_key', 'device_offline_timeout_seconds').maybeSingle(),
    ]);
    if (devices.error || events.error || offlineTimeoutSetting.error) return json({ error: 'Could not load system diagnostics. Apply the platform management migration first.' }, 503);
    const deviceIds = (devices.data || []).map(device => device.device_id);
    const readingBatches = await Promise.all(Array.from({ length: Math.ceil(deviceIds.length / 20) }, (_, index) =>
      service.from('sensor_readings').select('device_id,created_at').in('device_id', deviceIds.slice(index * 20, index * 20 + 20)).order('created_at', { ascending: false }).limit(1000)
    ));
    if (readingBatches.some(batch => batch.error)) return json({ error: 'Could not load recent accepted readings.' }, 503);
    const latestByDevice = new Map();
    for (const batch of readingBatches) for (const reading of batch.data || []) if (!latestByDevice.has(reading.device_id)) latestByDevice.set(reading.device_id, reading.created_at);
    const configuredTimeout = Number(offlineTimeoutSetting.data?.setting_value ?? 300);
    const offlineTimeoutSeconds = Number.isInteger(configuredTimeout) && configuredTimeout >= 30 && configuredTimeout <= 86400 ? configuredTimeout : 300;
    return json({ devices: (devices.data || []).map(device => ({ ...device, last_reading_at: latestByDevice.get(device.device_id) || null })), events: events.data || [], offline_timeout_seconds: offlineTimeoutSeconds });
  }

  if (body.action === 'create_aquarium') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) return json({ error: 'Enter an aquarium name with at most 120 characters.' }, 400);
    const { data: aquarium, error } = await service.from('aquariums')
      .insert({ name })
      .select('id,name,owner_id,created_at')
      .single();
    if (error) {
      await writeAudit(service, user.id, { action: 'aquarium_create', entity_type: 'aquarium', outcome: 'failure', metadata: { name } });
      console.error('Admin aquarium creation failed.', { code: error.code || 'unknown' });
      return json({ error: 'Could not create the aquarium. Check the aquarium schema and try again.' }, 500);
    }
    await writeAudit(service, user.id, { action: 'aquarium_create', entity_type: 'aquarium', entity_id: String(aquarium.id), outcome: 'success', metadata: { name: aquarium.name, owner_assigned: false } });
    return json({ aquarium });
  }

  if (body.action === 'list_content') {
    const { data, error } = await service.from('aquasense_knowledge_chunks')
      .select('id,title,content,source_title,source_url,category,is_published,is_archived,created_at,updated_at')
      .order('updated_at', { ascending: false }).limit(200);
    if (error) return json({ error: 'Could not load Explore content.' }, 503);
    return json({ content: data || [] });
  }

  if (body.action === 'save_content') {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const sourceTitle = typeof body.source_title === 'string' ? body.source_title.trim() : '';
    const sourceUrl = body.source_url === null || body.source_url === '' ? null : typeof body.source_url === 'string' ? body.source_url.trim() : undefined;
    const category = body.category;
    if (title.length < 1 || title.length > 200 || content.length < 20 || content.length > 12000 || !sourceTitle || sourceTitle.length > 200 || !CATEGORIES.includes(category as any) || sourceUrl === undefined || (sourceUrl && !/^https?:\/\//i.test(sourceUrl))) {
      return json({ error: 'Provide a title, at least 20 characters of content, source title, valid category, and an optional http(s) source URL.' }, 400);
    }
    const isPublished = body.is_published === true;
    const patch = { title, content, source_title: sourceTitle, source_url: sourceUrl, category, is_published: isPublished, is_archived: false, updated_by: user.id, updated_at: new Date().toISOString() };
    const id = body.id;
    const result = typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      ? await service.from('aquasense_knowledge_chunks').update(patch).eq('id', id).select('id').maybeSingle()
      : await service.from('aquasense_knowledge_chunks').insert(patch).select('id').single();
    if (result.error || !result.data) {
      await writeAudit(service, user.id, { action: 'content_save', entity_type: 'content', entity_id: String(id || ''), outcome: 'failure' });
      return json({ error: 'Could not save Explore content.' }, 500);
    }
    await writeAudit(service, user.id, { action: 'content_save', entity_type: 'content', entity_id: String(result.data.id), outcome: 'success', metadata: { category, is_published: isPublished } });
    return json({ ok: true, id: result.data.id });
  }

  if (body.action === 'set_content_state') {
    if (typeof body.id !== 'number' || !Number.isSafeInteger(body.id) || body.id < 1 || typeof body.is_published !== 'boolean' || typeof body.is_archived !== 'boolean') return json({ error: 'Provide a valid content ID and publication state.' }, 400);
    const { data, error } = await service.from('aquasense_knowledge_chunks').update({ is_published: body.is_published && !body.is_archived, is_archived: body.is_archived, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', body.id).select('id').maybeSingle();
    if (error) return json({ error: 'Could not update content status.' }, 500);
    if (!data) return json({ error: 'Content entry not found.' }, 404);
    await writeAudit(service, user.id, { action: body.is_archived ? 'content_archived' : body.is_published ? 'content_published' : 'content_unpublished', entity_type: 'content', entity_id: String(body.id), outcome: 'success' });
    return json({ ok: true });
  }

  if (body.action === 'list_admin_announcements') {
    const { data, error } = await service.from('aquasense_announcements').select('*').order('updated_at', { ascending: false }).limit(200);
    if (error) return json({ error: 'Could not load announcements.' }, 503);
    return json({ announcements: data || [] });
  }

  if (body.action === 'save_announcement') {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const category = body.category;
    const status = body.status;
    const publishAt = validIsoOrNull(body.publish_at);
    let expiresAt = validIsoOrNull(body.expires_at);
    if (title.length < 1 || title.length > 160 || message.length < 1 || message.length > 5000 || !ANNOUNCEMENT_CATEGORIES.includes(category as any) || !['draft', 'published', 'archived'].includes(String(status)) || publishAt === undefined || expiresAt === undefined) {
      return json({ error: 'Check the title, message, category, status, and publication dates.' }, 400);
    }
    if (status === 'published' && expiresAt === null) {
      const { data: visibilitySetting, error: visibilityError } = await service.from('aquasense_platform_settings')
        .select('setting_value').eq('setting_key', 'announcement_visibility_days').maybeSingle();
      if (visibilityError) return json({ error: 'Could not load the announcement visibility setting.' }, 503);
      const visibilityDays = Number(visibilitySetting?.setting_value ?? 7);
      if (!Number.isInteger(visibilityDays) || visibilityDays < 1 || visibilityDays > 365) return json({ error: 'The announcement visibility setting is invalid.' }, 503);
      const visibilityStartsAt = publishAt ? Date.parse(publishAt) : Date.now();
      expiresAt = new Date(visibilityStartsAt + visibilityDays * 24 * 60 * 60 * 1000).toISOString();
    }
    if (publishAt && expiresAt && Date.parse(expiresAt) <= Date.parse(publishAt)) return json({ error: 'The expiration date must be later than the publication date.' }, 400);
    const patch = { title, message, category, status, publish_at: publishAt, expires_at: expiresAt, updated_by: user.id, updated_at: new Date().toISOString() };
    const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null;
    const result = id
      ? await service.from('aquasense_announcements').update(patch).eq('id', id).select('id').maybeSingle()
      : await service.from('aquasense_announcements').insert({ ...patch, created_by: user.id }).select('id').single();
    if (result.error || !result.data) {
      await writeAudit(service, user.id, { action: 'announcement_save', entity_type: 'announcement', entity_id: id, outcome: 'failure' });
      return json({ error: 'Could not save announcement.' }, 500);
    }
    await writeAudit(service, user.id, { action: 'announcement_save', entity_type: 'announcement', entity_id: result.data.id, outcome: 'success', metadata: { category, status } });
    return json({ ok: true, id: result.data.id });
  }

  if (body.action === 'get_platform_settings') {
    const { data, error } = await service.from('aquasense_platform_settings').select('setting_key,setting_value,updated_at');
    if (error) return json({ error: 'Could not load platform settings.' }, 503);
    const settings = Object.fromEntries((data || []).map(row => [row.setting_key, row.setting_value]));
    return json({ settings: {
      default_announcement_category: settings.default_announcement_category || 'general',
      platform_timezone: settings.platform_timezone || 'UTC',
      announcement_visibility_days: Number(settings.announcement_visibility_days ?? 7),
      device_offline_timeout_seconds: Number(settings.device_offline_timeout_seconds ?? 300),
      maintenance_mode_enabled: settings.maintenance_mode_enabled === true,
      maintenance_mode_message: typeof settings.maintenance_mode_message === 'string' ? settings.maintenance_mode_message : 'AquaSense is undergoing scheduled maintenance. Some features may be temporarily unavailable.',
      esp32_minimum_interval_ms: Number(settings.esp32_minimum_interval_ms ?? 1000),
      esp32_temperature_min: Number(settings.esp32_temperature_min ?? 0),
      esp32_temperature_max: Number(settings.esp32_temperature_max ?? 50),
      esp32_ph_min: Number(settings.esp32_ph_min ?? 0),
      esp32_ph_max: Number(settings.esp32_ph_max ?? 14),
    } });
  }

  if (body.action === 'save_platform_settings') {
    const category = body.default_announcement_category;
    const timezone = body.platform_timezone;
    const announcementVisibilityDays = Number(body.announcement_visibility_days);
    const deviceOfflineTimeoutSeconds = Number(body.device_offline_timeout_seconds);
    const maintenanceEnabled = body.maintenance_mode_enabled;
    const maintenanceMessage = typeof body.maintenance_mode_message === 'string' ? body.maintenance_mode_message.trim() : '';
    const minimumIntervalMs = Number(body.esp32_minimum_interval_ms);
    const temperatureMin = Number(body.esp32_temperature_min);
    const temperatureMax = Number(body.esp32_temperature_max);
    const phMin = Number(body.esp32_ph_min);
    const phMax = Number(body.esp32_ph_max);
    const allowedZones = ['UTC', 'Asia/Manila', 'Asia/Singapore', 'America/Los_Angeles', 'America/New_York', 'Europe/London'];
    if (!ANNOUNCEMENT_CATEGORIES.includes(category as any) || typeof timezone !== 'string' || !allowedZones.includes(timezone) ||
      !Number.isInteger(announcementVisibilityDays) || announcementVisibilityDays < 1 || announcementVisibilityDays > 365 ||
      !Number.isInteger(deviceOfflineTimeoutSeconds) || deviceOfflineTimeoutSeconds < 30 || deviceOfflineTimeoutSeconds > 86400 ||
      typeof maintenanceEnabled !== 'boolean' || !maintenanceMessage || maintenanceMessage.length > 500 ||
      !Number.isInteger(minimumIntervalMs) || minimumIntervalMs < 100 || minimumIntervalMs > 60000 ||
      !Number.isFinite(temperatureMin) || !Number.isFinite(temperatureMax) || temperatureMin < 0 || temperatureMax > 50 || temperatureMin >= temperatureMax ||
      !Number.isFinite(phMin) || !Number.isFinite(phMax) || phMin < 0 || phMax > 14 || phMin >= phMax) {
      return json({ error: 'Check the maintenance message, ESP32 interval, and sensor ranges.' }, 400);
    }
    const now = new Date().toISOString();
    const { error } = await service.from('aquasense_platform_settings').upsert([
      { setting_key: 'default_announcement_category', setting_value: category, updated_by: user.id, updated_at: now },
      { setting_key: 'platform_timezone', setting_value: timezone, updated_by: user.id, updated_at: now },
      { setting_key: 'announcement_visibility_days', setting_value: announcementVisibilityDays, updated_by: user.id, updated_at: now },
      { setting_key: 'device_offline_timeout_seconds', setting_value: deviceOfflineTimeoutSeconds, updated_by: user.id, updated_at: now },
      { setting_key: 'maintenance_mode_enabled', setting_value: maintenanceEnabled, updated_by: user.id, updated_at: now },
      { setting_key: 'maintenance_mode_message', setting_value: maintenanceMessage, updated_by: user.id, updated_at: now },
      { setting_key: 'esp32_minimum_interval_ms', setting_value: minimumIntervalMs, updated_by: user.id, updated_at: now },
      { setting_key: 'esp32_temperature_min', setting_value: temperatureMin, updated_by: user.id, updated_at: now },
      { setting_key: 'esp32_temperature_max', setting_value: temperatureMax, updated_by: user.id, updated_at: now },
      { setting_key: 'esp32_ph_min', setting_value: phMin, updated_by: user.id, updated_at: now },
      { setting_key: 'esp32_ph_max', setting_value: phMax, updated_by: user.id, updated_at: now },
    ], { onConflict: 'setting_key' });
    if (error) {
      await writeAudit(service, user.id, { action: 'settings_update', entity_type: 'platform_settings', outcome: 'failure' });
      return json({ error: 'Could not save platform settings.' }, 500);
    }
    await writeAudit(service, user.id, { action: 'settings_update', entity_type: 'platform_settings', outcome: 'success', metadata: { default_announcement_category: category, platform_timezone: timezone, announcement_visibility_days: announcementVisibilityDays, device_offline_timeout_seconds: deviceOfflineTimeoutSeconds, maintenance_mode_enabled: maintenanceEnabled, esp32_minimum_interval_ms: minimumIntervalMs } });
    return json({ ok: true });
  }

  return json({ error: 'Unsupported administrative action.' }, 400);
});
