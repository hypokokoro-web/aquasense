-- Add platform maintenance, announcement visibility, and device monitoring controls.
alter table public.aquasense_platform_settings
  drop constraint if exists aquasense_platform_settings_setting_key_check;

alter table public.aquasense_platform_settings
  add constraint aquasense_platform_settings_setting_key_check check (
    setting_key in (
      'default_announcement_category',
      'platform_timezone',
      'maintenance_mode_enabled',
      'maintenance_mode_message',
      'announcement_visibility_days',
      'device_offline_timeout_seconds',
      'esp32_minimum_interval_ms',
      'esp32_temperature_min',
      'esp32_temperature_max',
      'esp32_ph_min',
      'esp32_ph_max'
    )
  );

insert into public.aquasense_platform_settings (setting_key, setting_value)
values
  ('maintenance_mode_enabled', 'false'::jsonb),
  ('maintenance_mode_message', '"AquaSense is undergoing scheduled maintenance. Some features may be temporarily unavailable."'::jsonb),
  ('announcement_visibility_days', '7'::jsonb),
  ('device_offline_timeout_seconds', '300'::jsonb),
  ('esp32_minimum_interval_ms', '1000'::jsonb),
  ('esp32_temperature_min', '0'::jsonb),
  ('esp32_temperature_max', '50'::jsonb),
  ('esp32_ph_min', '0'::jsonb),
  ('esp32_ph_max', '14'::jsonb)
on conflict (setting_key) do nothing;
