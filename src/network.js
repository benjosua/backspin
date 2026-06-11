import { Client } from '@colyseus/sdk';
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { CAMERA, COLORS, PHYSICS, TABLE } from './constants.js';
import { arenaFx, clampDt, damp, decayFx, raiseFx, resetFx } from './fx-state.js';
import { inputHud, resetInputHud } from './engine.js';
import { useGameStore } from './store.js';
import { initAudio, playBounce, playHit, playMenu, playNet } from './audio.js';
import { predictBounceKick } from '../shared/rally-core.js';

const clamp = MathUtils.clamp;
const url = import.meta.env.VITE_COLYSEUS_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:2567');
const client = new Client(url);
const browserNeedsPointerScale = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const chromium = /Chrome|Chromium|Edg\//.test(ua);
  const firefox = /Firefox/.test(ua);
  return (/Apple/.test(navigator.vendor || '') && !chromium) || firefox;
})();
const pointerScale = () => (browserNeedsPointerScale && window.devicePixelRatio) || 1;

function makeRacket(who, z) {
  return { who, x: 0, y: 0.62, z, rotX: who === 'player' ? -0.22 : 0.22, rotZ: 0, vx: 0, prevX: 0, flash: 0, swing: 0, baseZ: z, tell: 0 };
}

class NetworkGame {
  constructor() {
    this.room = null;
    this.side = null;
    this.remoteState = null;
    this.ball = new Vector3(0, 0.34, 0);
    this.vel = new Vector3();
    this.targetBall = new Vector3(0, 0.34, 0);
    this.targetVel = new Vector3();
    this.targetPlayerX = 0;
    this.targetAiX = 0;
    this.renderTargetBall = new Vector3(0, 0.34, 0);
    this.lastPatchAt = 0;
    this.snapNext = true;
    this.lastPointSeq = 0;
    this.spin = { top: 0, side: 0 };
    this.player = makeRacket('player', 4.8);
    this.ai = makeRacket('ai', -4.8);
    this.brain = { confidence: 0.5 };
    this.ballRotX = 0;
    this.ballRotY = 0;
    this.shadow = { x: 0, z: 0, op: 0, scale: 0.5 };
    this.marker = { x: 0, z: 0, kickX: 0, kickZ: 0, op: 0, spin: 0, side: 0, smash: 0 };
    this.aim = { x: 0, z: 0, op: 0, spinX: 0, spinY: 0, power: 0 };
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
    return this.join(client.joinOrCreate('rally', { mode: 'public', paddle: useGameStore.getState().paddle, name: 'PLAYER' }));
  }

  async createPrivate() {
    return this.join(client.create('rally', { mode: 'private', paddle: useGameStore.getState().paddle, name: 'PLAYER' }));
  }

  async joinPrivate(code) {
    const wanted = String(code).trim().toUpperCase();
    useGameStore.getState().setNetworkStatus('connecting');
    return this.join(client.joinById(wanted, { paddle: useGameStore.getState().paddle, name: 'PLAYER' }));
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
      if (message.type === 'hit') playHit(message.smash ? 1 : 0.4, this.remoteState?.rally || 0);
      if (message.type === 'point') playMenu(message.winner === this.side);
      if (message.type === 'net') playNet();
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
    this.room?.send('profile', { paddle: useGameStore.getState().paddle, name: 'PLAYER' });
  }

  async disconnect(goHome = true) {
    if (this.room) {
      const room = this.room;
      this.leaving = true;
      this.room = null;
      await room.leave(true).catch(() => {});
    }
    this.side = null;
    this.remoteState = null;
    resetInputHud();
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
    const server = s.server === local ? 'player' : 'ai';
    const winner = !s.winner ? null : s.winner === local ? 'player' : 'ai';
    const status = s.phase === 'waiting' ? 'waiting' : 'connected';
    if (s.pointSeq && s.pointSeq !== this.lastPointSeq) {
      this.lastPointSeq = s.pointSeq;
      const localWon = s.pointWinner === local;
      const label = s.pointReason === 'WINNER' && s.rally === 0 ? 'ACE' : s.pointReason;
      useGameStore.getState().flash(label || (localWon ? 'POINT' : 'POINT'), localWon ? COLORS.player : COLORS.ai);
    }
    useGameStore.getState().syncOnlineState({
      scoreP,
      scoreAI,
      phase: s.phase === 'waiting' ? 'serve' : s.phase,
      server,
      winner,
      networkStatus: status,
      roomCode: s.roomCode,
    });

    this.targetPlayerX = localIsP1 ? s.p1X : -s.p2X;
    this.targetAiX = localIsP1 ? -s.p2X : s.p1X;
    const flip = localIsP1 ? 1 : -1;
    this.targetBall.set(s.ballX * flip, s.ballY, s.ballZ * flip);
    this.targetVel.set(s.ballVx * flip, s.ballVy, s.ballVz * flip);
    this.lastPatchAt = performance.now();
    if (this.snapNext) {
      this.player.x = this.targetPlayerX;
      this.ai.x = this.targetAiX;
      this.ball.copy(this.targetBall);
      this.vel.copy(this.targetVel);
      this.snapNext = false;
    }
    this.spin.top = s.spinTop;
    this.spin.side = s.spinSide * flip;
    this.charge = localIsP1 ? s.p1Charge : s.p2Charge;
    this.ai.tell = localIsP1 ? s.p2Charge : s.p1Charge;
    inputHud.charge = this.charge;
    inputHud.charging = this.charging;
    inputHud.rally = s.rally;
  }

  newMatch() {}

  setPointerLocked(locked) { this.pointerLocked = locked; if (locked) this.syncCursorScreen(); }
  syncCursorScreen() {
    inputHud.cursorX = (this.ndcX + 1) * 0.5 * window.innerWidth;
    inputHud.cursorY = (1 - this.ndcY) * 0.5 * window.innerHeight;
  }
  onPointerMove(event) {
    let x; let y;
    if (this.pointerLocked) {
      const scale = pointerScale();
      x = clamp(this.ndcX + (event.movementX * scale / window.innerWidth) * 2, -1, 1);
      y = clamp(this.ndcY - (event.movementY * scale / window.innerHeight) * 2, -1, 1);
    } else {
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = -(event.clientY / window.innerHeight) * 2 + 1;
    }
    const seconds = event.timeStamp / 1000;
    const dt = seconds - this.lastT;
    if (dt > 0 && dt < 0.1) {
      this.pvx = this.pvx * 0.4 + ((x - this.lastNdcX) / dt) * 0.6;
      this.pvy = this.pvy * 0.4 + ((y - this.lastNdcY) / dt) * 0.6;
    }
    this.lastT = seconds;
    this.lastNdcX = x; this.lastNdcY = y; this.ndcX = x; this.ndcY = y;
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

  update(dt, time, camera, effects) {
    dt = clampDt(dt);
    const store = useGameStore.getState();
    if (!store.started || store.mode !== 'online') return;
    if (store.menuOpen && store.phase !== 'over') {
      decayFx(dt); inputHud.charging = false; return;
    }
    if (camera) {
      this.ndc.set(this.ndcX, this.ndcY);
      this.ray.setFromCamera(this.ndc, camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.aimX = clamp(this.hit.x / (TABLE.halfWidth + 0.5), -1, 1);
      }
    }
    const dir = Number(!!this.keys.r) - Number(!!this.keys.l);
    if (dir) this.inputX = clamp(this.inputX + dir * 10 * dt, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
    this.aimDepth = clamp((this.ndcY + 1) * 0.5, 0, 1);
    this.pvx = damp(this.pvx, 0, 9, dt);
    this.pvy = damp(this.pvy, 0, 9, dt);
    this.kTop = damp(this.kTop, 0, 6, dt);
    const now = performance.now();
    if (this.room && now - this.lastSend > 33) {
      this.lastSend = now;
      const serverX = this.side === 'p2' ? -this.inputX : this.inputX;
      const serverAimX = this.side === 'p2' ? -this.aimX : this.aimX;
      const aimY = clamp(this.ndcY, -1, 1);
      const payload = { x: serverX, y: aimY, aimX: serverAimX, aimDepth: this.aimDepth, vx: this.pvx, vy: this.pvy + this.kTop };
      this.room.send('input', payload);
    }
    const paddleEase = 1 - Math.exp(-26 * dt);
    const ballEase = 1 - Math.exp(-22 * dt);
    const predictedPlayerX = this.room ? this.inputX : this.targetPlayerX;
    this.player.prevX = this.player.x;
    this.ai.prevX = this.ai.x;
    this.player.x += (predictedPlayerX - this.player.x) * paddleEase;
    this.ai.x += (this.targetAiX - this.ai.x) * paddleEase;
    this.player.vx = (this.player.x - this.player.prevX) / Math.max(dt, 0.0001);
    this.ai.vx = (this.ai.x - this.ai.prevX) / Math.max(dt, 0.0001);
    const patchAge = Math.min(0.08, Math.max(0, (performance.now() - this.lastPatchAt) / 1000));
    this.renderTargetBall.copy(this.targetBall).addScaledVector(this.targetVel, patchAge);
    this.ball.lerp(this.renderTargetBall, ballEase);
    this.vel.lerp(this.targetVel, ballEase);

    inputHud.charge = this.charge;
    inputHud.charging = this.charging;
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
    const tableish = Math.abs(this.ball.x) < 3.25 && Math.abs(this.ball.z) < 5.15;
    this.shadow.x = this.ball.x;
    this.shadow.z = this.ball.z;
    this.shadow.op = tableish ? clamp(0.45 - this.ball.y * 0.09, 0.1, 0.45) : 0;
    this.shadow.scale = 0.5 + this.ball.y * 0.16;
    const aiming = store.phase === 'rally' || (store.phase === 'serve' && store.server === 'player');
    this.aim.x = this.aimX * TABLE.halfWidth * 0.96;
    this.aim.z = -(0.08 + this.aimDepth * 0.88) * TABLE.halfLength;
    this.aim.op = aiming ? clamp(0.12 + this.charge * 0.6, 0, 0.78) : 0;
    this.aim.spinX = inputHud.spinX;
    this.aim.spinY = inputHud.spinY;
    this.aim.power = this.charge;
    this.marker.op = 0;
    this.marker.spin = 0;
    this.marker.smash = 0;
    const incoming = store.phase === 'rally' && this.ball.z < PHYSICS.gravity && this.vel.z > 0;
    if (incoming && this.ball.y > TABLE.ballRadius) {
      const prediction = predictBounceKick(this.ball, this.vel, this.spin);
      if (prediction) {
        this.marker.x = prediction.x;
        this.marker.z = prediction.z;
        this.marker.kickX = prediction.kickX;
        this.marker.kickZ = prediction.kickZ;
        this.marker.spin = prediction.spin;
        this.marker.side = prediction.side;
        this.marker.smash = prediction.smash;
        this.marker.op = Math.abs(this.marker.x) < TABLE.halfWidth && Math.abs(this.marker.z) < TABLE.halfLength ? 0.32 + Math.sin(time * 10) * 0.08 : 0;
      }
    }
    this.netWobble = Math.max(0, this.netWobble - dt * 2.2);
    this.netRotX = Math.sin(time * 26) * this.netWobble * 0.1;
    arenaFx.heat = damp(arenaFx.heat, store.phase === 'rally' ? clamp(0.16 + (this.remoteState?.rally || 0) * 0.07, 0, 1) : 0, 2, dt);
    arenaFx.serveCharge = this.charge;
    arenaFx.rallyN = this.remoteState?.rally || 0;
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
