self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body: event.data?.text() || 'A new aquarium alert is available.' }; }

  event.waitUntil(self.registration.showNotification(payload.title || 'AquaSense alert', {
    body: payload.body || 'Check your aquarium status for details.',
    icon: payload.icon || '/images/aquasense-pwa.svg',
    badge: payload.badge || '/images/aquasense-pwa.svg',
    tag: payload.tag || 'aquasense-alert',
    data: { url: payload.url || '/#/alerts' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#/alerts', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin) && 'focus' in client);
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
