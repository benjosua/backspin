export const SOCIAL_NOTIFICATION_EVENT = 'backspin:social-notification';
export const OPEN_FRIENDS_EVENT = 'backspin:open-friends';

export function emitSocialNotification(payload, source = 'app') {
  if (typeof window === 'undefined' || !payload) return;
  window.dispatchEvent(new CustomEvent(SOCIAL_NOTIFICATION_EVENT, { detail: { ...payload, source } }));
}

export function emitOpenFriends(payload = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_FRIENDS_EVENT, { detail: payload }));
}

export function socialNotificationKey(payload = {}) {
  const kind = payload.kind || (payload.inviteId ? 'game_invite' : 'social');
  return `${kind}:${payload.requestId || payload.inviteId || `${payload.title || ''}:${payload.body || ''}`}`;
}
