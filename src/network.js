import { Client } from '@colyseus/sdk';
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { COLORS, TABLE } from './constants.js';
import { clampDt, damp, decayFx, resetFx } from './fx-state.js';
import { inputHud, resetInputHud, setInputCallout, decayInputCallout, syncCursorScreen as syncInputCursorScreen } from './view-state.js';
import { useGameStore } from './store.js';
import { initAudio, playHit } from './audio.js';
import { CONTACT, NET, POINT_RESET_DELAY_SECONDS, getEmote, sampleBallPlan, stepPaddleX } from '../shared/backspin-core.js';
import { predictBall as predictSharedBall } from '../shared/backspin-physics.js';
import { applyPointerVelocity, pointerEventToNdc, updateAimFromCamera } from './input-utils.js';
import {
  serveBallForRacket,
  syncGameplayAimAndHud,
  updateArenaVisuals,
  updateBallVisuals,
  updateGameplayCamera,
  updateGameplayPaddles,
  updateProjectionVisual,
} from './game-driver-view.js';
import { PlayableDriver } from './playable-driver.js';

const clamp = MathUtils.clamp;
const SERVER_BALL_LEAD_MIN = 0.018;
const SERVER_BALL_LEAD_MAX = 0.075;
const devBackendUrl = (import.meta.env.DEV && typeof window !== 'undefined')
  ? `${window.location.protocol}//${window.location.hostname}:2567`
  : '';
const url = import.meta.env.VITE_COLYSEUS_URL || devBackendUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:2567');
const client = new Client(url);
const httpBase = String(url).replace(/^ws/i, 'http').replace(/\/$/, '');
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
  await client.auth.signOut();
  useGameStore.getState().setAuth(null, null);
  useGameStore.getState().setRankedProfile(null);
}

export async function fetchMyMatches(limit = 20, offset = 0) {
  return apiFetch(`/api/me/matches?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
}

export async function fetchMyStats() {
  return apiFetch('/api/me/stats');
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
    this.renderTargetBall = new Vector3(0, 0.34, 0);
    this.predictedVel = new Vector3();
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
  }

  isConnected() { return !!this.room; }

  async quickMatch() {
    return this.join(client.joinOrCreate('backspin', { mode: 'public', name: playerName() }));
  }

  async testAiMatch(difficulty = 'pro') {
    return this.join(client.create('backspin', { mode: 'bot', botDifficulty: difficulty, name: playerName() }));
  }

  async createPrivate() {
    return this.join(client.create('backspin', { mode: 'private', name: playerName() }));
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
    return result;
  }

  async register(email, password) {
    await clearStaleAuthToken();
    const result = await client.auth.registerWithEmailAndPassword(email, password, { name: playerName() });
    await Promise.all([refreshRankedProfile(), refreshLeaderboard()]);
    return result;
  }

  async signOut() {
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
      const suppressPredictedLocalHitAudio = message.type === 'hit' && message.side === this.side && performance.now() - this.predictedHitAt < 280;
      this.processGameEvent(event, { exchange: this.remoteState?.exchange || 0, playAudio: !suppressPredictedLocalHitAudio });
    });
    room.onMessage('emote', (message) => {
      const emoji = getEmote(message?.emoteId) || message?.emoji;
      if (!emoji) return;
      useGameStore.getState().showEmote(message.side === this.side ? 'player' : 'ai', emoji);
    });
    room.onMessage('rematch', (message) => {
      if (message?.started) {
        this.snapNext = true;
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
    this.room?.send('profile', { name: playerName() });
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
    resetInputHud();
    useGameStore.getState().setOnlineRematchRequested(false);
    this.leaving = false;
    if (goHome) useGameStore.getState().goHome();
  }

  sideColor(side) { return side === this.side ? COLORS.player : COLORS.ai; }

  winnerIsLocal(side) { return side === this.side; }

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
        networkStatus: status,
        roomCode: s.roomCode,
        currentMatchId: s.matchId || '',
      },
    });

    const flip = localIsP1 ? 1 : -1;
    this.targetPlayerX = (localIsP1 ? s.p1X : s.p2X) * flip;
    this.targetAiX = (localIsP1 ? s.p2X : s.p1X) * flip;
    this.targetBall.set(s.ballX * flip, s.ballY, s.ballZ * flip);
    this.targetVel.set(s.ballVx * flip, s.ballVy, s.ballVz * flip);
    const patchNow = performance.now();
    if (this.lastPatchAt > 0) {
      const interval = clamp(patchNow - this.lastPatchAt, NET.patchMs * 0.5, NET.patchMs * 3);
      this.patchIntervalMs = this.patchIntervalMs * 0.85 + interval * 0.15;
    }
    this.lastPatchAt = patchNow;
    if (this.snapNext) {
      this.player.x = this.targetPlayerX;
      this.ai.x = this.targetAiX;
      this.ball.copy(this.targetBall);
      this.vel.copy(this.targetVel);
      this.snapNext = false;
    }
    this.spin.top = s.spinTop;
    this.spin.side = s.spinSide * flip;
    this.clientBallPlan = this.buildClientBallPlan(s, flip, patchNow);
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
  
  buildClientBallPlan(s, flip, patchNow) {
    if (!s?.ballPlanJSON) return null;
    let plan;
    try {
      plan = JSON.parse(s.ballPlanJSON);
    } catch {
      return null;
    }
    if (!plan?.id) return null;

    const serverStartMs = Number(plan.startMs) || 0;
    const startMs = patchNow - (Number(plan.elapsedMs) || 0);
    const flipPoint = (point) => point ? { ...point, x: (Number(point.x) || 0) * flip, z: (Number(point.z) || 0) * flip } : point;
    const flipVelocity = (velocity) => velocity ? { x: (Number(velocity.x) || 0) * flip, y: Number(velocity.y) || 0, z: (Number(velocity.z) || 0) * flip } : velocity;
    const flipSpin = (spin) => spin ? { top: Number(spin.top) || 0, side: (Number(spin.side) || 0) * flip } : spin;
    return {
      ...plan,
      startMs,
      start: flipPoint(plan.start),
      velocity: flipVelocity(plan.velocity),
      spin: flipSpin(plan.spin),
      target: flipPoint(plan.target),
      contact: flipPoint(plan.contact),
      segments: (plan.segments || []).map((seg) => ({
        ...seg,
        atMs: startMs + Math.max(0, (Number(seg.atMs) || 0) - serverStartMs),
        x: (Number(seg.x) || 0) * flip,
        z: (Number(seg.z) || 0) * flip,
        afterVelocity: flipVelocity(seg.afterVelocity),
        afterSpin: flipSpin(seg.afterSpin),
      })),
    };
  }

  predictBall(ball, vel, seconds) {
    if (this.clientBallPlan) {
      const sample = sampleBallPlan(this.clientBallPlan, performance.now() + seconds * 1000);
      ball.set(sample.x, sample.y, sample.z);
      vel.set(sample.vx || 0, sample.vy || 0, sample.vz || 0);
      this.spin.top = sample.spinTop || 0;
      this.spin.side = sample.spinSide || 0;
      return;
    }
    predictSharedBall(ball, vel, { top: this.spin.top, side: this.spin.side }, seconds, SERVER_BALL_LEAD_MAX + 0.05);
  }

  maybePlayPredictedLocalHit() {
    if (!this.room || !this.clientBallPlan || this.predictedHitPlanId === this.clientBallPlan.id || !this.charging) return;
    const store = useGameStore.getState();
    if (store.phase !== 'exchange') return;
    const incoming = this.remoteState?.lastHitter && this.remoteState.lastHitter !== this.side;
    if (!incoming) return;
    if (this.vel.z <= 0 || this.ball.z < CONTACT.racketZ - 0.75 || this.ball.z > CONTACT.racketZ + 0.25) return;
    if (this.ball.y < CONTACT.minY || this.ball.y > CONTACT.maxY) return;
    if (Math.abs(this.ball.x - this.player.x) > CONTACT.reachX + CONTACT.assistX) return;
    this.predictedHitPlanId = this.clientBallPlan.id;
    this.predictedHitAt = performance.now();
    playHit(this.charge || 0.4, this.remoteState?.exchange || 0);
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
    const paddleEase = 1 - Math.exp(-(32 * store.playerSpeed) * dt);
    const ballEase = 1 - Math.exp(-42 * dt);
    this.player.prevX = this.player.x;
    this.ai.prevX = this.ai.x;
    const playerStep = stepPaddleX(this.player.x, this.room ? this.inputX : this.targetPlayerX, dt, store.playerSpeed);
    this.player.x = playerStep.x;
    this.ai.x += (this.targetAiX - this.ai.x) * paddleEase;
    this.player.vx = playerStep.vx;
    this.ai.vx = (this.ai.x - this.ai.prevX) / Math.max(dt, 0.0001);
    this.renderTargetBall.copy(this.targetBall);
    this.predictedVel.copy(this.targetVel);
    if (store.phase === 'point') this.pointVisualT = Math.max(0, this.pointVisualT - dt);
    if (store.phase === 'serve') {
      const racket = store.server === 'player' ? this.player : this.ai;
      const serveBall = serveBallForRacket(racket);
      this.renderTargetBall.set(serveBall.x, serveBall.y, serveBall.z);
      this.predictedVel.set(0, 0, 0);
    } else if (store.phase === 'exchange' || store.phase === 'point') {
      const sincePatch = Math.max(0, (performance.now() - this.lastPatchAt) / 1000);
      const lead = clamp((this.patchIntervalMs + this.rttMs * 0.35) / 1000, SERVER_BALL_LEAD_MIN, SERVER_BALL_LEAD_MAX);
      this.predictBall(this.renderTargetBall, this.predictedVel, sincePatch + lead);
    }
    if (this.ball.distanceToSquared(this.renderTargetBall) > 4) this.ball.copy(this.renderTargetBall);
    else this.ball.lerp(this.renderTargetBall, ballEase);
    this.vel.lerp(this.predictedVel, 1 - Math.exp(-48 * dt));

    this.maybePlayPredictedLocalHit();
    const playerIncoming = store.phase === 'exchange' && (this.remoteState?.lastHitter ? this.remoteState.lastHitter !== this.side : this.vel.z > 0);
    const aiIncoming = store.phase === 'exchange' && (this.remoteState?.lastHitter ? this.remoteState.lastHitter === this.side : this.vel.z < 0);
    const exchange = this.remoteState?.exchange || 0;
    syncGameplayAimAndHud(this, {
      charge: this.charge,
      charging: this.charging,
      exchange,
      canInfluence: store.phase === 'exchange' || (store.phase === 'serve' && store.server === 'player'),
    });
    updateGameplayPaddles(this, dt, { playerIncoming, aiIncoming });
    updateBallVisuals(this, dt);
    updateProjectionVisual(this, { phase: store.phase, incoming: playerIncoming });
    updateArenaVisuals(this, store.phase, exchange, this.charge, dt, time, { raiseOverScore: true });
    updateGameplayCamera(this, dt, time);
  }
}

export const networkGame = new NetworkGame();
export function getActiveGame() {
  return useGameStore.getState().mode === 'online' ? networkGame : null;
}
