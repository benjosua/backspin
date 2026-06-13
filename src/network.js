import { Client } from '@colyseus/sdk';
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { CAMERA, COLORS, PHYSICS, TABLE } from './constants.js';
import { arenaFx, clampDt, damp, decayFx, raiseFx, resetFx } from './fx-state.js';
import { inputHud, resetInputHud } from './engine.js';
import { useGameStore } from './store.js';
import { initAudio, playBounce, playHit, playMenu, playNet } from './audio.js';
import { NET, POINT_RESET_DELAY_SECONDS, getEmote, predictBounceKick, stepPaddleX } from '../shared/backspin-core.js';
import { predictBall as predictSharedBall } from '../shared/backspin-physics.js';
import { applyMarkerPrediction, makeAim, makeMarker, makeRacket, makeShadow, updateShadow, resetMarker } from '../shared/backspin-view-model.js';
import { applyPointerVelocity, pointerEventToNdc, updateAimFromCamera } from './input-utils.js';

const clamp = MathUtils.clamp;
const SERVER_BALL_LEAD_MIN = 0.018;
const SERVER_BALL_LEAD_MAX = 0.075;
const PADDLE_Y = 0.62;
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
  useGameStore.getState().setAuth(user || null, token || null);
  if (user) refreshRankedProfile().catch(() => useGameStore.getState().setRankedProfile(null));
  else useGameStore.getState().setRankedProfile(null);
  refreshLeaderboard().catch(() => {});
});


class NetworkGame {
  constructor() {
    this.room = null;
    this.queueRoom = null;
    this.side = null;
    this.remoteState = null;
    this.ball = new Vector3(0, 0.34, 0);
    this.vel = new Vector3();
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
    this.spin = { top: 0, side: 0 };
    this.player = makeRacket('player', 4.8);
    this.ai = makeRacket('ai', -4.8);
    this.brain = { confidence: 0.5 };
    this.ballRotX = 0;
    this.ballRotY = 0;
    this.shadow = makeShadow();
    this.marker = makeMarker();
    this.aim = makeAim();
    this.netWobble = 0;
    this.netRotX = 0;
    this.shake = 0;
    this.overT = 0;
    this.volley = 0;
    this.ndcX = 0;
    this.ndcY = 0;
    this.lastT = 0;
    this.lastNdcX = 0;
    this.lastNdcY = 0;
    this.pvx = 0;
    this.pvy = 0;
    this.kTop = 0;
    this.charging = false;
    this.charge = 0;
    this.inputX = 0;
    this.aimX = 0;
    this.aimDepth = 0.5;
    this.usingKeys = false;
    this.keys = { l: false, r: false };
    this.pointerLocked = false;
    this.lastSend = 0;
    this.lastPing = 0;
    this.rttMs = 66;
    this.leaving = false;
    this.ray = new Raycaster();
    this.plane = new Plane(new Vector3(0, 1, 0), -0.62);
    this.ndc = new Vector2();
    this.hit = new Vector3();
    const [x, y, z] = CAMERA.desktopPosition;
    const [lx, ly, lz] = CAMERA.desktopTarget;
    this.camX = x; this.camY = y; this.camZ = z;
    this.camLX = lx; this.camLY = ly; this.camLZ = lz;
    this.camFov = 44;
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
    const result = await client.auth.signInWithEmailAndPassword(email, password);
    await Promise.all([refreshRankedProfile(), refreshLeaderboard()]);
    return result;
  }

  async register(email, password) {
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
      if (message.type === 'bounce') playBounce();
      if (message.type === 'hit') playHit(message.smash ? 1 : 0.4, this.remoteState?.exchange || 0);
      if (message.type === 'point') playMenu(message.winner === this.side);
      if (message.type === 'net') playNet();
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
    resetInputHud();
    useGameStore.getState().setOnlineRematchRequested(false);
    this.leaving = false;
    if (goHome) useGameStore.getState().goHome();
  }

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
    useGameStore.getState().syncOnlineState({
      scoreP,
      scoreAI,
      phase: s.phase === 'waiting' ? 'serve' : s.phase,
      server,
      winner,
      playerName: localName || playerName(),
      opponentName: opponentName || 'OPPONENT',
      networkStatus: status,
      roomCode: s.roomCode,
      currentMatchId: s.matchId || '',
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
    this.charge = s.phase === 'point' ? 0 : localIsP1 ? s.p1Charge : s.p2Charge;
    this.ai.tell = localIsP1 ? s.p2Charge : s.p1Charge;
    inputHud.charge = this.charge;
    inputHud.charging = s.phase === 'point' ? false : this.charging;
    inputHud.exchange = s.exchange;
  }

  newMatch() {}

  setPointerLocked(locked) { this.pointerLocked = locked; if (locked) this.syncCursorScreen(); }
  syncCursorScreen() {
    inputHud.cursorX = (this.ndcX + 1) * 0.5 * window.innerWidth;
    inputHud.cursorY = (1 - this.ndcY) * 0.5 * window.innerHeight;
  }
  onPointerMove(event) {
    const { x, y } = pointerEventToNdc(event, this.ndcX, this.ndcY, this.pointerLocked);
    applyPointerVelocity(this, event, x, y);
    this.syncCursorScreen();
  }
  onPointerDown(event) {
    if (event.pointerType !== 'mouse' || event.button === 0) {
      initAudio();
      this.onPointerMove(event);
      this.charging = true;
      this.room?.send('charge', { charging: true });
    }
  }
  onPointerUp(event) {
    if (event?.pointerType === 'mouse' && event.button !== 0) return;
    this.charging = false;
    this.room?.send('charge', { charging: false });
    const state = useGameStore.getState();
    if (state.phase === 'serve' && state.server === 'player') this.room?.send('serve');
  }
  onKeyDown(event) {
    const emoteId = emoteKeyId(event.code);
    if (emoteId) {
      const state = useGameStore.getState();
      if (!event.repeat && !isTypingTarget(event.target) && state.mode === 'online' && state.networkStatus === 'connected' && !state.menuOpen && state.phase !== 'over') {
        this.sendEmote(emoteId);
        event.preventDefault();
      }
      return;
    }
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') { this.keys.l = true; this.usingKeys = true; }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') { this.keys.r = true; this.usingKeys = true; }
    if (event.code === 'ArrowUp' || event.code === 'KeyW') this.kTop = 0.85;
    if (event.code === 'ArrowDown' || event.code === 'KeyS') this.kTop = -0.7;
    if (event.code === 'Space' || event.code === 'Enter') { initAudio(); this.charging = true; this.room?.send('charge', { charging: true }); event.preventDefault(); }
  }
  onKeyUp(event) {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.keys.l = false;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.keys.r = false;
    if (event.code === 'Space' || event.code === 'Enter') this.onPointerUp();
  }

  predictBall(ball, vel, seconds) {
    predictSharedBall(ball, vel, { top: this.spin.top, side: this.spin.side }, seconds, SERVER_BALL_LEAD_MAX + 0.05);
  }

  update(dt, time, camera, effects) {
    dt = clampDt(dt);
    const store = useGameStore.getState();
    if (!store.started || store.mode !== 'online') return;
    if (store.menuOpen && store.phase !== 'over') {
      decayFx(dt); inputHud.charging = false; return;
    }
    updateAimFromCamera(this, camera, TABLE.halfWidth);
    const dir = Number(!!this.keys.r) - Number(!!this.keys.l);
    if (dir) this.inputX = clamp(this.inputX + dir * 19 * store.playerSpeed * dt, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
    this.aimDepth = clamp((this.ndcY + 1) * 0.5, 0, 1);
    this.pvx = damp(this.pvx, 0, 9, dt);
    this.pvy = damp(this.pvy, 0, 9, dt);
    this.kTop = damp(this.kTop, 0, 6, dt);
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
      this.renderTargetBall.set(racket.x, PADDLE_Y + 0.34, racket.baseZ + (racket.who === 'player' ? -0.45 : 0.45));
      this.predictedVel.set(0, 0, 0);
    } else if (store.phase === 'exchange' || store.phase === 'point') {
      const sincePatch = Math.max(0, (performance.now() - this.lastPatchAt) / 1000);
      const lead = clamp((this.patchIntervalMs + this.rttMs * 0.35) / 1000, SERVER_BALL_LEAD_MIN, SERVER_BALL_LEAD_MAX);
      this.predictBall(this.renderTargetBall, this.predictedVel, sincePatch + lead);
    }
    if (this.ball.distanceToSquared(this.renderTargetBall) > 4) this.ball.copy(this.renderTargetBall);
    else this.ball.lerp(this.renderTargetBall, ballEase);
    this.vel.lerp(this.predictedVel, 1 - Math.exp(-48 * dt));

    const canInfluence = store.phase === 'exchange' || (store.phase === 'serve' && store.server === 'player');
    inputHud.charge = canInfluence ? this.charge : 0;
    inputHud.charging = canInfluence && this.charging;
    inputHud.aimX = this.aimX;
    inputHud.aimDepth = this.aimDepth;
    inputHud.aimLabel = `${this.aimX < -0.25 ? 'LEFT' : this.aimX > 0.25 ? 'RIGHT' : 'CENTER'} · ${this.aimDepth < 0.35 ? 'SHORT' : this.aimDepth > 0.7 ? 'DEEP' : 'MID'}`;
    inputHud.spinX = clamp(this.pvx * 0.12, -1, 1);
    inputHud.spinY = clamp((this.pvy + this.kTop) * 0.12, -1, 1);
    inputHud.spinMag = Math.min(1, Math.hypot(inputHud.spinX, inputHud.spinY));

    for (const racket of [this.player, this.ai]) {
      const sign = racket.who === 'player' ? 1 : -1;
      racket.y = 0.62;
      racket.z = racket.baseZ;
      racket.flash = Math.max(0, racket.flash - dt * 4);
      racket.rotX = (racket.who === 'player' ? -0.22 : 0.22) + racket.swing * sign * 0.3;
      racket.rotZ = damp(racket.rotZ, clamp(-racket.vx * 0.045, -0.45, 0.45), 10, dt);
    }
    this.ballRotX -= (2 + this.spin.top * 16) * dt;
    this.ballRotY += this.spin.side * 14 * dt;
    updateShadow(this.shadow, this.ball, TABLE);
    const aiming = canInfluence;
    this.aim.x = this.aimX * TABLE.halfWidth * 0.96;
    this.aim.z = -(0.08 + this.aimDepth * 0.88) * TABLE.halfLength;
    this.aim.op = aiming ? clamp(0.12 + this.charge * 0.6, 0, 0.78) : 0;
    this.aim.spinX = inputHud.spinX;
    this.aim.spinY = inputHud.spinY;
    this.aim.power = this.charge;
    resetMarker(this.marker);
    const incoming = store.phase === 'exchange' && this.ball.z < PHYSICS.gravity && this.vel.z > 0;
    if (incoming && this.ball.y > TABLE.ballRadius) {
      const prediction = predictBounceKick(this.ball, this.vel, this.spin);
      applyMarkerPrediction(this.marker, prediction, TABLE, time);
    }
    this.netWobble = Math.max(0, this.netWobble - dt * 2.2);
    this.netRotX = Math.sin(time * 26) * this.netWobble * 0.1;
    arenaFx.heat = damp(arenaFx.heat, store.phase === 'exchange' ? clamp(0.16 + (this.remoteState?.exchange || 0) * 0.07, 0, 1) : 0, 2, dt);
    arenaFx.serveCharge = this.charge;
    arenaFx.exchangeN = this.remoteState?.exchange || 0;
    decayFx(dt);
    if (store.phase === 'over') raiseFx('score', 0.2);

    const heat = arenaFx.heat;
    const bob = Math.sin(time * (1 + heat)) * (0.03 + heat * 0.07);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.camX = damp(this.camX, CAMERA.introPosition[0] + this.ndcX * 0.7, 2.5, dt);
    this.camY = damp(this.camY, CAMERA.introPosition[1] + this.ndcY * 0.35 + bob, 2.5, dt);
    this.camZ = damp(this.camZ, CAMERA.introPosition[2] - heat * 1.4, 2.8, dt);
    this.camLX = damp(this.camLX, CAMERA.introTarget[0], 2.4, dt);
    this.camLY = damp(this.camLY, CAMERA.introTarget[1], 2.4, dt);
    this.camLZ = damp(this.camLZ, CAMERA.introTarget[2], 2.4, dt);
    this.camFov = damp(this.camFov, 38, 2.6, dt);
  }
}

export const networkGame = new NetworkGame();
export function getActiveGame() {
  return useGameStore.getState().mode === 'online' ? networkGame : null;
}
