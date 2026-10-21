-- Keep administrator membership from granting elevated access to OAuth-only
-- sessions. The amr claim is issued in the signed Supabase Auth JWT.
-- The existing admin allowlist remains the source of administrator identity.

create or replace function public.is_aquasense_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'amr') @> '[{"method":"password"}]'::jsonb,
    false
  ) and exists (
    select 1
    from public.aquasense_admins a
    where a.user_id = auth.uid()
  );
$$;

-- Administrators may own aquariums, but OAuth-only sessions for those same
-- accounts must not fall back to regular-owner access through owner_id checks.
create or replace function public.is_aquasense_owner_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.aquasense_admins a where a.user_id = auth.uid()
  ) or coalesce(
    (auth.jwt() -> 'amr') @> '[{"method":"password"}]'::jsonb,
    false
  );
$$;

create or replace function public.owns_aquarium(target_aquarium_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_aquasense_owner_session() and exists (
    select 1 from public.aquariums a
    where a.id = target_aquarium_id and a.owner_id = auth.uid()
  );
$$;

-- The aquarium policies include a direct owner_id check, so update them to
-- route owner access through the same verified-session rule.
alter policy "Ownership fence for aquariums" on public.aquariums
  using (public.owns_aquarium(id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(id) or public.is_aquasense_admin());
alter policy "Aquarium owners and admins read aquariums" on public.aquariums
  using (public.owns_aquarium(id) or public.is_aquasense_admin());
alter policy "Users create owned aquariums" on public.aquariums
  with check (owner_id = auth.uid() and public.is_aquasense_owner_session());
alter policy "Owners and admins update aquariums" on public.aquariums
  using (public.owns_aquarium(id) or public.is_aquasense_admin())
  with check (public.owns_aquarium(id) or public.is_aquasense_admin());
alter policy "Owners and admins delete aquariums" on public.aquariums
  using (public.owns_aquarium(id) or public.is_aquasense_admin());

revoke all on function public.is_aquasense_admin() from public;
grant execute on function public.is_aquasense_admin() to authenticated;
grant execute on function public.is_aquasense_admin() to anon;
revoke all on function public.is_aquasense_owner_session() from public;
grant execute on function public.is_aquasense_owner_session() to authenticated;
grant execute on function public.is_aquasense_owner_session() to anon;
revoke all on function public.owns_aquarium(bigint) from public;
grant execute on function public.owns_aquarium(bigint) to authenticated;
grant execute on function public.owns_aquarium(bigint) to anon;
