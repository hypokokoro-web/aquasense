alter table public.aquarium_settings enable row level security;

drop policy if exists "Aquasense admins manage aquarium settings" on public.aquarium_settings;
create policy "Aquasense admins manage aquarium settings"
  on public.aquarium_settings for all to authenticated
  using (public.is_aquasense_admin())
  with check (public.is_aquasense_admin());

grant select, insert, update, delete on public.aquarium_settings to authenticated;

notify pgrst, 'reload schema';
