import { Client } from '@colyseus/sdk';
import { Vector3 } from 'three';
import { COLORS, DEFAULT_RACKET_COLOR } from './constants.js';
import { clampDt, damp, decayFx, resetFx } from './fx-state.js';
import { inputHud, resetInputHud, setInputCallout, decayInputCallout, syncCursorScreen as syncInputCursorScreen } from './view-state.js';
import { useGameStore } from './store.js';
import { initAudio } from './audio.js';
import { NET, POINT_RESET_DELAY_SECONDS, clamp, getEmote, predictBall as predictSharedBall, sampleBallPlan, stepPaddleX } from '../serve/src/shared/game-core.js';
import { applyPointerVelocity, pointerEventToNdc, updateAimFromCamera } from './input-utils.js';
import {
  isIncoming,
  serveBallForRacket,
} from './game-driver-view.js';
import { PlayableDriver } from './playable-driver.js';
import { emitSocialNotification } from './social-notifications.js';
import {
  NETWORK_RENDERING,
  ballLeadSeconds,
  extrapolatePaddleX,
  localContactAtVisualTime,
  localizeBallPlan,
  predictedHitHoldActive,
} from './network-rendering.js';
const devBackendUrl = (import.meta.env.DEV && typeof window !== 'undefined')
  ? `${window.location.protocol}//${window.location.hostname}:2567`
  : '';
const url = import.meta.env.VITE_COLYSEUS_URL || devBackendUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:2567');
const client = new Client(url);
const httpBase = String(url).replace(/^ws/i, 'http').replace(/\/$/, '');
const LIVE_PLAYER_SESSION_KEY = 'backspin.livePlayerSessionId';
let livePlayerSessionId = '';
let socialRoom = null;
let socialConnectPromise = null;
let socialVisibilityCleanup = null;
let socialReconnectTimer = 0;
let socialConnectGeneration = 0;
const playerName = () => useGameStore.getState().playerName || 'PLAYER';
const authHeader = () => (client.auth.token ? { Authorization: `Bearer ${client.auth.token}` } : {});
const emoteKeyId = (code) => {
  const match = /^(?:Digit|Numpad)([1-4])$/.exec(code || '');
  return match?.[1] || null;
};
const isTypingTarget = (target) => {
  const tag = target?.tagName?.toLowerCase?.();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
};

async function apiFetch(path, options = {}) {
  const response = await fetch(`${httpBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

async function refreshRankedProfile() {
  if (!client.auth.token) {
    useGameStore.getState().setRankedProfile(null);
    return null;
  }
  const { profile } = await apiFetch('/api/me/rank');
  useGameStore.getState().setRankedProfile(profile);
  return profile;
}

async function refreshLeaderboard() {
  const { leaderboard } = await apiFetch('/api/leaderboard?limit=50');
  useGameStore.getState().setLeaderboard(leaderboard || []);
  return leaderboard;
}

async function clearStaleAuthToken() {
  if (!client.auth.token) return;
  await disconnectSocialNotifications();
  await client.auth.signOut();
  useGameStore.getState().setAuth(null, null);
  useGameStore.getState().setRankedProfile(null);
}

function isDocumentVisible() {
  return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function dispatchSocialNotification(payload, source = 'socket') {
  emitSocialNotification(payload, source);
}

function clearSocialReconnect() {
  if (!socialReconnectTimer) return;
  clearTimeout(socialReconnectTimer);
  socialReconnectTimer = 0;
}

function scheduleSocialReconnect() {
  if (!client.auth.token || socialReconnectTimer) return;
  socialReconnectTimer = setTimeout(() => {
    socialReconnectTimer = 0;
    connectSocialNotifications().catch(() => scheduleSocialReconnect());
  }, 1500);
}

function cleanupSocialVisibility() {
  socialVisibilityCleanup?.();
  socialVisibilityCleanup = null;
}

function bindSocialRoom(room) {
  const sendVisibility = () => room.send('visibility', { visible: isDocumentVisible() });
  room.onMessage('friend_request', (payload) => dispatchSocialNotification(payload, 'socket'));
  room.onMessage('game_invite', (payload) => dispatchSocialNotification(payload, 'socket'));
  if (typeof document !== 'undefined') {
    cleanupSocialVisibility();
    document.addEventListener('visibilitychange', sendVisibility);
    socialVisibilityCleanup = () => document.removeEventListener('visibilitychange', sendVisibility);
  }
  room.onLeave((code) => {
    if (socialRoom !== room) return;
    socialRoom = null;
    cleanupSocialVisibility();
    if (code !== 1000) scheduleSocialReconnect();
  });
}

export async function connectSocialNotifications() {
  if (!client.auth.token || typeof window === 'undefined') return null;
  if (socialRoom) return socialRoom;
  if (socialConnectPromise) return socialConnectPromise;
  clearSocialReconnect();
  const generation = socialConnectGeneration;
  socialConnectPromise = client.joinOrCreate('social', { visible: isDocumentVisible() })
    .then((room) => {
      if (generation !== socialConnectGeneration || !client.auth.token) {
        room.leave(true).catch(() => {});
        return null;
      }
      socialRoom = room;
      bindSocialRoom(room);
      return room;
    })
    .catch((error) => {
      socialRoom = null;
      throw error;
    })
    .finally(() => {
      socialConnectPromise = null;
    });
  return socialConnectPromise;
}

export async function disconnectSocialNotifications() {
  socialConnectGeneration += 1;
  clearSocialReconnect();
  cleanupSocialVisibility();
  const room = socialRoom;
  socialRoom = null;
  socialConnectPromise = null;
  if (room) await room.leave(true).catch(() => {});
}

export async function fetchMyMatches(limit = 20, offset = 0) {
  return apiFetch(`/api/me/matches?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
}

export async function fetchMyStats() {
  return apiFetch('/api/me/stats');
}

export async function fetchLivePlayers() {
  return apiFetch('/api/live');
}

function getLivePlayerSessionId() {
  if (livePlayerSessionId) return livePlayerSessionId;
  const next = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (typeof sessionStorage === 'undefined') {
    livePlayerSessionId = next;
    return livePlayerSessionId;
  }
  livePlayerSessionId = sessionStorage.getItem(LIVE_PLAYER_SESSION_KEY) || next;
  sessionStorage.setItem(LIVE_PLAYER_SESSION_KEY, livePlayerSessionId);
  return livePlayerSessionId;
}

export async function refreshLivePlayerPresence() {
  return apiFetch('/api/live/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ sessionId: getLivePlayerSessionId() }),
  });
}

export async function fetchFriends() {
  return apiFetch('/api/friends');
}

export async function searchUsers(query) {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return { users: [] };
  return apiFetch(`/api/users/search?q=${q}`);
}

export async function sendFriendRequest(recipientId) {
  return apiFetch('/api/friend-requests', {
    method: 'POST',
    body: JSON.stringify({ recipientId }),
  });
}

export async function acceptFriendRequest(requestId) {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(requestId)}/accept`, { method: 'POST' });
}

export async function declineFriendRequest(requestId) {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(requestId)}/decline`, { method: 'POST' });
}

export async function createGameInvite(recipientId, roomCode) {
  return apiFetch('/api/game-invites', {
    method: 'POST',
    body: JSON.stringify({ recipientId, roomCode }),
  });
}

export async function resolveGameInvite(inviteId) {
  return apiFetch(`/api/game-invites/${encodeURIComponent(inviteId)}`);
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function sameBytes(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.every((value, index) => value === right[index]);
}

export async function enablePushNotifications() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Push notifications are not supported in this browser');
  }
  const { enabled, publicKey } = await apiFetch('/api/push/vapid-public-key');
  if (enabled === false) throw new Error('Push is not configured on this server');
  if (!publicKey) throw new Error('Push is not configured on this server');
  const applicationServerKey = base64UrlToUint8Array(publicKey);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission denied');
  const registration = await navigator.serviceWorker.register('/sw.js');
  const existing = await registration.pushManager.getSubscription();
  let subscription = existing;
  if (existing?.options?.applicationServerKey && !sameBytes(existing.options.applicationServerKey, applicationServerKey)) {
    await apiFetch('/api/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: existing.endpoint }),
    }).catch(() => {});
    await existing.unsubscribe();
    subscription = null;
  }
  subscription ||= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  await apiFetch('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return subscription;
}

export async function disablePushNotifications() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const registration = registrations.find((item) => item.active?.scriptURL?.endsWith('/sw.js')) || await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return false;
  await apiFetch('/api/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  return subscription.unsubscribe();
}

export async function consumeInviteFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get('invite');
  if (!inviteId) return null;
  const { invite } = await resolveGameInvite(inviteId);
  await networkGame.joinPrivate(invite.roomCode);
  params.delete('invite');
  const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', next);
  return invite;
}
async function syncAccountName(name) {
  if (!client.auth.token) return null;
  const { user, profile } = await apiFetch('/api/me/name', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  useGameStore.getState().setAuth(user || null, client.auth.token);
  useGameStore.getState().setRankedProfile(profile || null);
  await refreshLeaderboard();
  return user;
}

async function updateRacketColor(colorId) {
  const { profile } = await apiFetch('/api/me/racket-color', {
    method: 'PATCH',
    body: JSON.stringify({ colorId }),
  });
  useGameStore.getState().setRankedProfile(profile || null);
  networkGame.sendProfile();
  return profile;
}

client.auth.onChange(({ user, token }) => {
  if (!user && token === undefined && client.auth.token) {
    clearStaleAuthToken().catch(() => {
      client.auth.token = null;
      useGameStore.getState().setAuth(null, null);
    });
  }
  useGameStore.getState().setAuth(user || null, token || null);
  if (user) refreshRankedProfile().catch(() => useGameStore.getState().setRankedProfile(null));
  else useGameStore.getState().setRankedProfile(null);
  if (user) connectSocialNotifications().catch(() => scheduleSocialReconnect());
  else disconnectSocialNotifications().catch(() => {});
  refreshLeaderboard().catch(() => {});
});


class NetworkGame extends PlayableDriver {
  constructor() {
    super();
    this.room = null;
    this.queueRoom = null;
    this.side = null;
    this.remoteState = null;
    this.ball.set(0, 0.34, 0);
    this.targetBall = new Vector3(0, 0.34, 0);
    this.targetVel = new Vector3();
    this.targetPlayerX = 0;
    this.targetAiX = 0;
    this.targetAiVx = 0;
    this.renderTargetBall = new Vector3(0, 0.34, 0);
    this.predictedVel = new Vector3();
    this.ballCorrection = new Vector3();
    this.lastPatchAt = 0;
    this.patchIntervalMs = NET.patchMs;
    this.snapNext = true;
    this.lastPointSeq = 0;
    this.pointVisualT = 0;
    this.lastSend = 0;
    this.lastPing = 0;
    this.rttMs = 66;
    this.leaving = false;
    this.clientBallPlan = null;
    this.predictedHitPlanId = 0;
    this.predictedHitAt = 0;
    this.predictedHitHold = null;
  }

  isConnected() { return !!this.room; }

  async quickMatch() {
    return this.join(client.joinOrCreate('backspin', { mode: 'public', name: playerName() }));
  }

  async testAiMatch(difficulty = 'level3') {
    return this.join(client.create('backspin', { mode: 'bot', botDifficulty: difficulty, name: playerName() }));
  }

  async createPrivate() {
    return this.join(client.create('backspin', { mode: 'private', name: playerName() }));
  }

  async inviteFriend(recipientId) {
    let roomCode = useGameStore.getState().roomCode;
    if (!this.room || this.remoteState?.mode !== 'private' || !roomCode) {
      const room = await this.createPrivate();
      roomCode = room?.state?.roomCode || useGameStore.getState().roomCode;
    }
    if (!roomCode) throw new Error('Room code not ready');
    return createGameInvite(recipientId, roomCode);
  }

  async joinPrivate(code) {
    const wanted = String(code).trim().toUpperCase();
    useGameStore.getState().setNetworkStatus('connecting');
    return this.join(client.joinById(wanted, { name: playerName() }));
  }

  async signIn(email, password) {
    await clearStaleAuthToken();
    const result = await client.auth.signInWithEmailAndPassword(email, password);
    await Promise.all([refreshRankedProfile(), refreshLeaderboard()]);
    await connectSocialNotifications().catch(() => {});
    return result;
  }

  async register(email, password) {
    await clearStaleAuthToken();
    const result = await client.auth.registerWithEmailAndPassword(email, password, { name: playerName() });
    await Promise.all([refreshRankedProfile(), refreshLeaderboard()]);
    await connectSocialNotifications().catch(() => {});
    return result;
  }

  async signOut() {
    await disconnectSocialNotifications();
    await client.auth.signOut();
    useGameStore.getState().setRankedProfile(null);
  }

  async refreshLeaderboard() {
    return refreshLeaderboard();
  }

  async updateAccountName(name = playerName()) {
    const user = await syncAccountName(name);
    this.sendProfile();
    return user;
  }

  async updateRacketColor(colorId) {
    return updateRacketColor(colorId);
  }

  async rankedMatch() {
    if (!client.auth.token) throw new Error('Sign in required for ranked');
    await this.disconnect(false);
    useGameStore.getState().setNetworkStatus('connecting');
    const queue = await client.joinOrCreate('ranked_queue', { mode: 'ranked', name: playerName(), rank: 1 });
    this.queueRoom = queue;
    useGameStore.getState().setNetworkStatus('waiting');
    queue.onMessage('clients', (count) => useGameStore.getState().setRankedQueueCount(count || 1));
    queue.onMessage('seat', async (reservation) => {
      try {
        queue.send('confirm');
        const match = await client.consumeSeatReservation(reservation);
        this.queueRoom = null;
        await this.join(Promise.resolve(match));
      } catch (error) {
        useGameStore.getState().setNetworkStatus('disconnected', error?.message || 'Ranked join failed');
      }
    });
    queue.onLeave(() => {
      if (this.queueRoom === queue) this.queueRoom = null;
    });
    return queue;
  }

  async join(promise) {
    await this.disconnect(false);
    useGameStore.getState().setNetworkStatus('connecting');
    try {
      const room = await promise;
      this.leaving = false;
      this.room = room;
      this.side = null;
      this.remoteState = room.state;
      this.snapNext = true;
      this.lastPatchAt = 0;
      this.patchIntervalMs = NET.patchMs;
      this.ballCorrection.set(0, 0, 0);
      this.predictedHitPlanId = 0;
      this.predictedHitAt = 0;
      this.predictedHitHold = null;
      resetFx();
      resetInputHud();
      useGameStore.getState().startOnline();
      this.bindRoom(room);
      this.syncFromState(room.state);
      return room;
    } catch (error) {
      useGameStore.getState().setNetworkStatus('disconnected', error?.message || 'Connection failed');
      throw error;
    }
  }

  bindRoom(room) {
    room.onMessage('side', ({ side, roomCode }) => {
      this.side = side;
      useGameStore.getState().setOnlineSide(side, roomCode);
      this.sendProfile();
    });
    room.onMessage('fx', (message) => {
      const flip = this.side === 'p2' ? -1 : 1;
      const event = message.type === 'bounce' ? { ...message, x: (message.x || 0) * flip, z: (message.z || 0) * flip } : message;
      const alreadyPredictedLocalHit = message.type === 'hit' && message.side === this.side && performance.now() - this.predictedHitAt < 280;
      if (!alreadyPredictedLocalHit || message.smash) {
        this.processGameEvent(event, { exchange: this.remoteState?.exchange || 0, playAudio: !alreadyPredictedLocalHit });
      }
    });
    room.onMessage('emote', (message) => {
      const emoji = getEmote(message?.emoteId) || message?.emoji;
      if (!emoji) return;
      useGameStore.getState().showEmote(message.side === this.side ? 'player' : 'ai', emoji);
    });
    room.onMessage('rematch', (message) => {
      if (message?.started) {
        this.snapNext = true;
        this.predictedHitPlanId = 0;
        this.predictedHitAt = 0;
        this.predictedHitHold = null;
        resetFx();
        resetInputHud();
        useGameStore.getState().setOnlineRematchRequested(false);
      } else if (message?.requestedBy === this.side) {
        useGameStore.getState().setOnlineRematchRequested(true);
      }
    });
    room.onStateChange((state) => this.syncFromState(state));
    room.onDrop(() => useGameStore.getState().setNetworkStatus('reconnecting'));
    room.onReconnect(() => useGameStore.getState().setNetworkStatus('connected'));
    room.onLeave(() => {
      this.room = null;
      if (!this.leaving) useGameStore.getState().setNetworkStatus('disconnected', 'Disconnected');
    });
  }

  sendProfile() {
    this.room?.send('profile', { name: playerName(), racketColor: useGameStore.getState().rankedProfile?.selectedRacketColor || DEFAULT_RACKET_COLOR });
  }

  sendEmote(emoteId) {
    if (!getEmote(emoteId)) return false;
    this.room?.send('emote', { emoteId });
    return true;
  }

  requestRematch() {
    if (!this.room || useGameStore.getState().phase !== 'over') return false;
    useGameStore.getState().setOnlineRematchRequested(true);
    this.room.send('rematch');
    return true;
  }


  async disconnect(goHome = true) {
    if (this.queueRoom) {
      const queue = this.queueRoom;
      this.queueRoom = null;
      await queue.leave(true).catch(() => {});
    }
    if (this.room) {
      const room = this.room;
      this.leaving = true;
      this.room = null;
      await room.leave(true).catch(() => {});
    }
    this.side = null;
    this.remoteState = null;
    this.clientBallPlan = null;
    this.predictedHitPlanId = 0;
    this.predictedHitAt = 0;
    this.predictedHitHold = null;
    resetInputHud();
    useGameStore.getState().setOnlineRematchRequested(false);
    this.leaving = false;
    if (goHome) useGameStore.getState().goHome();
  }

  sideColor(side) { return side === this.side ? COLORS.player : COLORS.ai; }

  winnerIsLocal(side) { return side === this.side; }

  mapEventSideToRacket(side) { return side === this.side ? 'player' : 'ai'; }

  syncFromState(s) {
    if (!s || s.roomCode == null) return;
    this.remoteState = s;
    if (!this.side && this.room?.sessionId) {
      if (this.room.sessionId === s.p1) this.side = 'p1';
      else if (this.room.sessionId === s.p2) this.side = 'p2';
      if (this.side) useGameStore.getState().setOnlineSide(this.side, s.roomCode);
    }
    const local = this.side || 'p1';
    const localIsP1 = local === 'p1';
    const scoreP = localIsP1 ? s.scoreP1 : s.scoreP2;
    const scoreAI = localIsP1 ? s.scoreP2 : s.scoreP1;
    const localName = localIsP1 ? s.p1Name : s.p2Name;
    const opponentName = localIsP1 ? s.p2Name : s.p1Name;
    const playerRacketColor = localIsP1 ? s.p1RacketColor : s.p2RacketColor;
    const opponentRacketColor = localIsP1 ? s.p2RacketColor : s.p1RacketColor;
    const server = s.server === local ? 'player' : 'ai';
    const winner = !s.winner ? null : s.winner === local ? 'player' : 'ai';
    const status = s.phase === 'waiting' ? 'waiting' : 'connected';
    if (s.pointSeq && s.pointSeq !== this.lastPointSeq) {
      this.lastPointSeq = s.pointSeq;
      this.pointVisualT = s.phase === 'point' ? POINT_RESET_DELAY_SECONDS : 0;
      this.charging = false;
      this.charge = 0;
      const localWon = s.pointWinner === local;
      const label = s.pointReason === 'WINNER' && s.exchange === 0 ? 'ACE' : s.pointReason;
      useGameStore.getState().flash(label || (localWon ? 'POINT' : 'POINT'), localWon ? COLORS.player : COLORS.ai);
    }
    if (s.phase !== 'point') this.pointVisualT = 0;
    this.syncPlayStore({ scoreP, scoreAI, phase: s.phase === 'waiting' ? 'serve' : s.phase, server, winner }, {
      setter: 'syncOnlineState',
      extra: {
        playerName: localName || playerName(),
        opponentName: opponentName || 'OPPONENT',
        playerRacketColor: playerRacketColor || DEFAULT_RACKET_COLOR,
        opponentRacketColor: opponentRacketColor || DEFAULT_RACKET_COLOR,
        networkStatus: status,
        roomCode: s.roomCode,
        currentMatchId: s.matchId || '',
      },
    });

    const flip = localIsP1 ? 1 : -1;
    this.targetPlayerX = (localIsP1 ? s.p1X : s.p2X) * flip;
    this.targetAiX = (localIsP1 ? s.p2X : s.p1X) * flip;
    this.targetAiVx = (Number(localIsP1 ? s.p2Vx : s.p1Vx) || 0) * flip;
    this.targetBall.set(s.ballX * flip, s.ballY, s.ballZ * flip);
    this.targetVel.set(s.ballVx * flip, s.ballVy, s.ballVz * flip);
    const patchNow = performance.now();
    if (this.lastPatchAt > 0) {
      const interval = clamp(patchNow - this.lastPatchAt, NET.patchMs * 0.5, NET.patchMs * 3);
      this.patchIntervalMs = this.patchIntervalMs * 0.85 + interval * 0.15;
    }
    this.lastPatchAt = patchNow;
    const shouldSnap = this.snapNext;
    if (shouldSnap) {
      this.player.x = this.targetPlayerX;
      this.ai.x = this.targetAiX;
      this.ball.copy(this.targetBall);
      this.vel.copy(this.targetVel);
      this.ballCorrection.set(0, 0, 0);
      this.snapNext = false;
    }
    this.spin.top = s.spinTop;
    this.spin.side = s.spinSide * flip;
    const previousPlan = this.clientBallPlan;
    this.clientBallPlan = this.buildClientBallPlan(s, flip, patchNow, previousPlan);
    if (this.predictedHitHold && (s.phase !== 'exchange' || this.clientBallPlan?.id !== this.predictedHitHold.planId)) {
      this.predictedHitHold = null;
    }
    if (!this.clientBallPlan) {
      this.ballCorrection.set(0, 0, 0);
    } else if (!shouldSnap && this.clientBallPlan !== previousPlan) {
      this.beginBallCorrection(patchNow);
    }
    this.charge = s.phase === 'point' ? 0 : localIsP1 ? s.p1Charge : s.p2Charge;
    this.ai.tell = localIsP1 ? s.p2Charge : s.p1Charge;
    inputHud.charge = this.charge;
    inputHud.charging = s.phase === 'point' ? false : this.charging;
    inputHud.exchange = s.exchange;
  }

  newMatch() {}

  onChargeStart() {
    this.room?.send('charge', { charging: true });
  }

  onChargeEnd() {
    this.room?.send('charge', { charging: false });
    const state = useGameStore.getState();
    if (state.phase === 'serve' && state.server === 'player') this.room?.send('serve');
  }

  handleEmoteKey(event) {
    const emoteId = emoteKeyId(event.code);
    if (emoteId) {
      const state = useGameStore.getState();
      if (!event.repeat && !isTypingTarget(event.target) && state.mode === 'online' && state.networkStatus === 'connected' && !state.menuOpen && state.phase !== 'over') {
        this.sendEmote(emoteId);
        event.preventDefault();
      }
      return true;
    }
    return false;
  }
  
  buildClientBallPlan(s, flip, patchNow, previousPlan) {
    return localizeBallPlan(s?.ballPlanJSON, s?.ballPlanElapsedMs, flip, patchNow, previousPlan);
  }

  sampleClientBallPlanAt(nowMs, ball = this.renderTargetBall, vel = this.predictedVel) {
    if (!this.clientBallPlan) return false;
    const sample = sampleBallPlan(this.clientBallPlan, nowMs);
    ball.set(sample.x, sample.y, sample.z);
    vel.set(sample.vx || 0, sample.vy || 0, sample.vz || 0);
    this.spin.top = sample.spinTop || 0;
    this.spin.side = sample.spinSide || 0;
    return true;
  }

  beginBallCorrection(nowMs) {
    this.sampleClientBallPlanAt(nowMs + ballLeadSeconds(this.patchIntervalMs, this.rttMs) * 1000);
    this.ballCorrection.copy(this.ball).sub(this.renderTargetBall);
    if (this.ballCorrection.lengthSq() > NETWORK_RENDERING.ballSnapDistance ** 2) {
      this.ball.copy(this.renderTargetBall);
      this.vel.copy(this.predictedVel);
      this.ballCorrection.set(0, 0, 0);
    }
  }

  maybePredictLocalHit(nowMs, visualNowMs) {
    if (!this.room || !this.clientBallPlan || this.predictedHitPlanId === this.clientBallPlan.id) return;
    const store = useGameStore.getState();
    const contact = localContactAtVisualTime({
      plan: this.clientBallPlan,
      side: this.side,
      phase: store.phase,
      incoming: isIncoming({ phase: store.phase, lastHitter: this.remoteState?.lastHitter, velocity: this.vel }, this.side),
      visualNowMs,
      paddleX: this.player.x,
    });
    if (!contact) return;
    this.predictedHitPlanId = this.clientBallPlan.id;
    this.predictedHitAt = nowMs;
    this.predictedHitHold = {
      planId: this.clientBallPlan.id,
      startedAtMs: nowMs,
      ball: { x: contact.x, y: contact.y, z: contact.z },
    };
    this.ball.set(contact.x, contact.y, contact.z);
    this.vel.set(0, 0, 0);
    this.ballCorrection.set(0, 0, 0);
    this.processGameEvent(
      { type: 'hit', side: this.side, contact },
      { exchange: this.remoteState?.exchange || 0 },
    );
  }

  update(dt, time, camera, effects) {
    this.fx = effects;
    dt = clampDt(dt);
    const store = useGameStore.getState();
    if (!store.started || store.mode !== 'online') return;
    if (store.menuOpen && store.phase !== 'over') {
      decayFx(dt); inputHud.charging = false; return;
    }
    decayInputCallout(dt);
    this.updateInputState(dt, store.playerSpeed, camera);
    const now = performance.now();
    if (this.room && now - this.lastSend >= NET.inputSendMs) {
      this.lastSend = now;
      const flip = this.side === 'p2' ? -1 : 1;
      const aimY = clamp(this.ndcY, -1, 1);
      const payload = {
        x: this.inputX * flip,
        y: aimY,
        aimX: this.aimX * flip,
        aimDepth: this.aimDepth,
        vx: this.pvx * flip,
        vy: this.pvy + this.kTop,
        speed: store.playerSpeed,
      };
      this.room.send('input', payload);
    }
    if (this.room && now - this.lastPing >= 1500 && typeof this.room.ping === 'function') {
      this.lastPing = now;
      this.room.ping((latency) => {
        if (Number.isFinite(latency)) this.rttMs = this.rttMs * 0.75 + latency * 0.25;
      });
    }
    this.player.prevX = this.player.x;
    this.ai.prevX = this.ai.x;
    const playerStep = stepPaddleX(this.player.x, this.room ? this.inputX : this.targetPlayerX, dt, store.playerSpeed);
    this.player.x = playerStep.x;
    const secondsSincePatch = Math.max(0, (now - this.lastPatchAt) / 1000);
    const remotePaddleX = extrapolatePaddleX(this.targetAiX, this.targetAiVx, secondsSincePatch);
    this.ai.x = damp(this.ai.x, remotePaddleX, NETWORK_RENDERING.remotePaddleFollow, dt);
    this.player.vx = playerStep.vx;
    this.ai.vx = (this.ai.x - this.ai.prevX) / Math.max(dt, 0.0001);
    this.renderTargetBall.copy(this.targetBall);
    this.predictedVel.copy(this.targetVel);
    if (store.phase === 'point') this.pointVisualT = Math.max(0, this.pointVisualT - dt);
    let visualNow = now;
    if (store.phase === 'serve') {
      const racket = store.server === 'player' ? this.player : this.ai;
      const serveBall = serveBallForRacket(racket);
      this.renderTargetBall.set(serveBall.x, serveBall.y, serveBall.z);
      this.predictedVel.set(0, 0, 0);
    } else if (store.phase === 'exchange' || store.phase === 'point') {
      const lead = ballLeadSeconds(this.patchIntervalMs, this.rttMs);
      visualNow = now + lead * 1000;
      if (!this.sampleClientBallPlanAt(visualNow)) {
        predictSharedBall(
          this.renderTargetBall,
          this.predictedVel,
          { top: this.spin.top, side: this.spin.side },
          secondsSincePatch + lead,
          NETWORK_RENDERING.maxBallLeadSeconds + NETWORK_RENDERING.maxPaddleExtrapolationSeconds,
        );
      }
    }
    if (predictedHitHoldActive(this.predictedHitHold, this.clientBallPlan?.id, store.phase, now)) {
      const held = this.predictedHitHold.ball;
      this.renderTargetBall.set(held.x, held.y, held.z);
      this.predictedVel.set(0, 0, 0);
    } else if (this.predictedHitHold) {
      this.predictedHitHold = null;
    }
    if (this.clientBallPlan && (store.phase === 'exchange' || store.phase === 'point')) {
      this.ball.copy(this.renderTargetBall).add(this.ballCorrection);
      this.ballCorrection.multiplyScalar(Math.exp(-NETWORK_RENDERING.ballCorrectionRate * dt));
      this.vel.copy(this.predictedVel);
    } else {
      const ballEase = 1 - Math.exp(-NETWORK_RENDERING.fallbackBallFollow * dt);
      if (this.ball.distanceToSquared(this.renderTargetBall) > NETWORK_RENDERING.ballSnapDistance ** 2) this.ball.copy(this.renderTargetBall);
      else this.ball.lerp(this.renderTargetBall, ballEase);
      this.vel.lerp(this.predictedVel, 1 - Math.exp(-NETWORK_RENDERING.fallbackVelocityFollow * dt));
    }

    this.maybePredictLocalHit(now, visualNow);
    const incomingState = { phase: store.phase, lastHitter: this.remoteState?.lastHitter, velocity: this.vel };
    const aiSide = this.side === 'p1' ? 'p2' : 'p1';
    const playerIncoming = isIncoming(incomingState, this.side);
    const aiIncoming = isIncoming(incomingState, aiSide);
    const exchange = this.remoteState?.exchange || 0;
    this.updateAimHud({
      charge: this.charge,
      charging: this.charging,
      exchange,
      canInfluence: store.phase === 'exchange' || (store.phase === 'serve' && store.server === 'player'),
    });
    this.updateVisuals(dt, time, {
      phase: store.phase,
      exchange,
      charge: this.charge,
      playerIncoming,
      aiIncoming,
      projection: { incoming: playerIncoming },
      arena: { raiseOverScore: true },
    });
  }
}

export const networkGame = new NetworkGame();
export function getActiveGame() {
  return useGameStore.getState().mode === 'online' ? networkGame : null;
}
