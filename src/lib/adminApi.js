import { aquasenseAdminUrl, supabase, supabasePublishableKey } from './supabase';

export async function callAquaSenseAdmin(action, fields = {}) {
  if (!supabase || !aquasenseAdminUrl) throw new Error('AquaSense services are not configured.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('Could not verify your session. Sign in again.');
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session expired. Sign in again.');
  const response = await fetch(aquasenseAdminUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The requested operation failed.');
  return result;
}
