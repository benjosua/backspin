self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'Backspin invite';
  const body = data.body || 'A friend invited you to play';
  const payload = {
    ...data,
    title,
    body,
    url: data.url || '/',
  };
  const tag = data.kind === 'friend_request'
    ? (data.requestId ? `backspin-friend-request-${data.requestId}` : 'backspin-friend-request')
    : (data.inviteId ? `backspin-invite-${data.inviteId}` : 'backspin-invite');
  const options = {
    body,
    tag,
    timestamp: Date.now(),
    data: { url: payload.url },
  };
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visibleWindows = windows.filter((client) => client.visibilityState === 'visible');
    if (visibleWindows.length) {
      visibleWindows.forEach((client) => client.postMessage({ type: 'backspin:push-notification', payload }));
      return;
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const matchingClient = windows.find((client) => client.url === url);
    if (matchingClient) return matchingClient.focus();
    return clients.openWindow(url);
  })());
});
