-- Allow the verified admin Edge Function to revoke a user's refresh sessions.
-- Existing signed access tokens remain valid until their normal expiry.

create or replace function public.revoke_aquasense_user_sessions(target_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  revoked_count integer;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  delete from auth.sessions where user_id = target_user_id;
  get diagnostics revoked_count = row_count;
  return revoked_count;
end;
$$;

revoke all on function public.revoke_aquasense_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_aquasense_user_sessions(uuid) to service_role;
