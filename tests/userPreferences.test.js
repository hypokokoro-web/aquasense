import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_USER_PREFERENCES, isWithinQuietHours, normalizeUserPreferences } from '../src/lib/userPreferences.js';

test('preferences normalize supported values and reject unknown formats', () => {
  const value = normalizeUserPreferences({
    notifications: { browser: true, email: true, quietStart: 'not-a-time' },
    appearance: { theme: 'neon', temperatureUnit: 'F', timeFormat: '24h', dateFormat: 'iso', defaultAquariumId: 12 },
  });
  assert.equal(value.notifications.browser, true);
  assert.equal(value.notifications.email, false);
  assert.equal(value.notifications.quietStart, DEFAULT_USER_PREFERENCES.notifications.quietStart);
  assert.equal(value.appearance.theme, 'system');
  assert.equal(value.appearance.temperatureUnit, 'F');
  assert.equal(value.appearance.defaultAquariumId, '12');
});

test('quiet hours support both same-day and overnight intervals', () => {
  assert.equal(isWithinQuietHours(new Date('2026-10-22T21:30:00'), '20:00', '22:00'), true);
  assert.equal(isWithinQuietHours(new Date('2026-10-22T23:30:00'), '22:00', '07:00'), true);
  assert.equal(isWithinQuietHours(new Date('2026-10-22T08:00:00'), '22:00', '07:00'), false);
  assert.equal(isWithinQuietHours(new Date('2026-10-22T08:00:00'), '08:00', '08:00'), false);
});
