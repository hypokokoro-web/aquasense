export const DEFAULT_USER_PREFERENCES = Object.freeze({
  notifications: Object.freeze({
    waterQuality: true,
    temperature: true,
    ph: true,
    maintenance: true,
    feeding: true,
    browser: false,
    email: false,
    quietHoursEnabled: false,
    quietStart: '22:00',
    quietEnd: '07:00',
  }),
  appearance: Object.freeze({
    theme: 'system',
    temperatureUnit: 'C',
    timeFormat: '12h',
    dateFormat: 'locale',
    defaultAquariumId: null,
  }),
});

const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function normalizeUserPreferences(value) {
  const notifications = value?.notifications && typeof value.notifications === 'object' ? value.notifications : {};
  const appearance = value?.appearance && typeof value.appearance === 'object' ? value.appearance : {};
  return {
    notifications: {
      waterQuality: notifications.waterQuality !== false,
      temperature: notifications.temperature !== false,
      ph: notifications.ph !== false,
      maintenance: notifications.maintenance !== false,
      feeding: notifications.feeding !== false,
      browser: notifications.browser === true,
      email: false,
      quietHoursEnabled: notifications.quietHoursEnabled === true,
      quietStart: validTime(notifications.quietStart) ? notifications.quietStart : DEFAULT_USER_PREFERENCES.notifications.quietStart,
      quietEnd: validTime(notifications.quietEnd) ? notifications.quietEnd : DEFAULT_USER_PREFERENCES.notifications.quietEnd,
    },
    appearance: {
      theme: ['system', 'light', 'dark'].includes(appearance.theme) ? appearance.theme : 'system',
      temperatureUnit: appearance.temperatureUnit === 'F' ? 'F' : 'C',
      timeFormat: appearance.timeFormat === '24h' ? '24h' : '12h',
      dateFormat: appearance.dateFormat === 'iso' ? 'iso' : 'locale',
      defaultAquariumId: appearance.defaultAquariumId != null && /^[1-9]\d{0,18}$/.test(String(appearance.defaultAquariumId))
        ? String(appearance.defaultAquariumId)
        : null,
    },
  };
}

export function isWithinQuietHours(now, start, end) {
  if (!validTime(start) || !validTime(end) || start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}
