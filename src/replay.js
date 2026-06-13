import { MathUtils, Vector3 } from 'three';
import { CAMERA, TABLE } from './constants.js';
import { arenaFx, clampDt, damp, decayFx, resetFx } from './fx-state.js';
import { inputHud, resetInputHud } from './engine.js';
import { useGameStore } from './store.js';
import { makeAim, makeMarker, makeRacket, makeShadow, updateShadow, resetMarker } from '../shared/backspin-view-model.js';

const replayDevBackendUrl = (import.meta.env.DEV && typeof window !== 'undefined')
  ? `${window.location.protocol}//${window.location.hostname}:2567`
  : '';
const replayBaseUrl = import.meta.env.VITE_COLYSEUS_URL || replayDevBackendUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:2567');
const replayHttpBase = String(replayBaseUrl).replace(/^ws/i, 'http').replace(/\/$/, '');
const clamp = MathUtils.clamp;
const minReplayPitch = -0.2;
const maxReplayPitch = 1.15;
const minReplayDistance = 5.5;
const maxReplayDistance = 24;

const PHASE_BY_CODE = { [-1]: 'waiting', 0: 'serve', 1: 'exchange', 2: 'point', 3: 'over' };

async function replayFetch(path, token) {
  const response = await fetch(`${replayHttpBase}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Replay request failed');
  return data;
}

function flattenReplayFrames(replay) {
  return (replay?.chunks || []).flatMap((chunk) => chunk.frames || []).sort((a, b) => a[0] - b[0]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function decodeFrame(frame) {
  return {
    timeMs: frame[0],
    ball: { x: frame[1], y: frame[2], z: frame[3] },
    velocity: { x: frame[4], y: frame[5], z: frame[6] },
    spin: { top: frame[7], side: frame[8] },
    p1: { x: frame[9], charge: frame[11] },
    p2: { x: frame[10], charge: frame[12] },
    score: { p1: frame[13], p2: frame[14] },
    phase: PHASE_BY_CODE[frame[15]] || 'waiting',
    server: frame[16] === 2 ? 'p2' : 'p1',
    exchange: frame[17],
  };
}

function blendFrames(a, b, timeMs) {
  if (!a || !b || a === b || b[0] <= a[0]) return decodeFrame(a || b);
  const t = Math.max(0, Math.min(1, (timeMs - a[0]) / (b[0] - a[0])));
  const out = [...a];
  for (let i = 1; i <= 12; i += 1) out[i] = lerp(a[i], b[i], t);
  return decodeFrame(out);
}

export class ServerReplayPlayer {
  constructor(replay) {
    this.replay = replay;
    this.frames = flattenReplayFrames(replay);
    this.points = replay?.points || [];
    this.shots = replay?.shots || [];
    this.durationMs = this.frames.at(-1)?.[0] || replay?.match?.durationMs || 0;
    this.cursorMs = 0;
    this.current = this.frames[0] ? decodeFrame(this.frames[0]) : null;
  }

  static async load(matchId, token) {
    return new ServerReplayPlayer(await replayFetch(`/api/matches/${encodeURIComponent(matchId)}/replay`, token));
  }

  static async loadShot(matchId, shotId, token) {
    const replay = await replayFetch(`/api/matches/${encodeURIComponent(matchId)}/shots/${encodeURIComponent(shotId)}/replay`, token);
    return new ServerReplayPlayer({ match: replay.match, shots: [replay.shot], points: [], chunks: [{ frames: replay.frames }] });
  }

  seek(timeMs) {
    if (!this.frames.length) return null;
    this.cursorMs = Math.max(0, Math.min(this.durationMs, Number(timeMs) || 0));
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.frames[mid][0] <= this.cursorMs) lo = mid;
      else hi = mid - 1;
    }
    this.current = blendFrames(this.frames[lo], this.frames[Math.min(lo + 1, this.frames.length - 1)], this.cursorMs);
    return this.current;
  }

  jumpToPoint(seq) {
    const point = this.points.find((item) => item.seq === seq);
    return point ? this.seek(point.timeMs) : null;
  }

  jumpToShot(shotId) {
    const shot = this.shots.find((item) => item.id === shotId || item.seq === shotId);
    return shot ? this.seek(shot.timeMs) : null;
  }
}

export async function fetchMatchSummary(matchId, token) {
  return replayFetch(`/api/matches/${encodeURIComponent(matchId)}`, token);
}

export async function fetchMatchReplay(matchId, token) {
  return replayFetch(`/api/matches/${encodeURIComponent(matchId)}/replay`, token);
}

export async function fetchShotReplay(matchId, shotId, token) {
  return replayFetch(`/api/matches/${encodeURIComponent(matchId)}/shots/${encodeURIComponent(shotId)}/replay`, token);
}


class ReplayGame {
  constructor() {
    this.player = makeRacket('player', 4.8);
    this.ai = makeRacket('ai', -4.8);
    this.ball = new Vector3(0, 0.34, 0);
    this.vel = new Vector3();
    this.spin = { top: 0, side: 0 };
    this.shadow = makeShadow();
    this.marker = makeMarker();
    this.aim = makeAim();
    this.brain = { confidence: 0.5 };
    this.netWobble = 0;
    this.netRotX = 0;
    this.ballRotX = 0;
    this.ballRotY = 0;
    this.shake = 0;
    const [x, y, z] = CAMERA.playPosition;
    const [lx, ly, lz] = CAMERA.playTarget;
    this.camX = x; this.camY = y; this.camZ = z;
    this.camLX = lx; this.camLY = ly; this.camLZ = lz;
    this.camFov = 50;
    const rel = new Vector3(x - lx, y - ly, z - lz);
    this.cameraTarget = new Vector3(lx, ly, lz);
    this.cameraYaw = Math.atan2(rel.x, rel.z);
    this.cameraPitch = Math.asin(clamp(rel.y / Math.max(0.0001, rel.length()), -1, 1));
    this.cameraDistance = rel.length();
    this.cameraDrag = null;
    this.playerRef = null;
    this.viewerSide = 'p1';
    this.lastReplayTimeUiAt = 0;
  }

  resetCamera() {
    const [x, y, z] = CAMERA.playPosition;
    const [lx, ly, lz] = CAMERA.playTarget;
    const rel = new Vector3(x - lx, y - ly, z - lz);
    this.cameraTarget.set(lx, ly, lz);
    this.cameraYaw = Math.atan2(rel.x, rel.z);
    this.cameraPitch = Math.asin(clamp(rel.y / Math.max(0.0001, rel.length()), -1, 1));
    this.cameraDistance = rel.length();
    this.cameraDrag = null;
  }

  async load(matchId, token, viewerSide = 'p1') {
    useGameStore.getState().setReplayLoading();
    try {
      const player = await ServerReplayPlayer.load(matchId, token);
      this.playerRef = player;
      const match = player.replay?.match || null;
      const side = viewerSide === 'p2' || match?.p2UserId === useGameStore.getState().authUser?.id ? 'p2' : 'p1';
      this.viewerSide = side;
      resetFx();
      resetInputHud();
      this.resetCamera();
      this.lastReplayTimeUiAt = 0;
      useGameStore.getState().startReplayMode({
        match,
        stats: player.replay?.stats || null,
        viewerSide: side,
        durationMs: player.durationMs,
      });
      this.seek(0);
      return player;
    } catch (error) {
      useGameStore.getState().setReplayError(error?.message || 'Replay failed');
      throw error;
    }
  }

  syncReplayTime(force = false) {
    if (!this.playerRef) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this.lastReplayTimeUiAt < 100 && this.playerRef.cursorMs < this.playerRef.durationMs) return;
    this.lastReplayTimeUiAt = now;
    useGameStore.getState().setReplayTime(this.playerRef.cursorMs);
  }

  seek(timeMs, syncUi = true) {
    if (!this.playerRef) return null;
    const frame = this.playerRef.seek(timeMs);
    if (frame) this.applyFrame(frame);
    if (syncUi) this.syncReplayTime(true);
    return frame;
  }

  jumpToPoint(seq) {
    const frame = this.playerRef?.jumpToPoint(seq);
    if (frame) {
      this.applyFrame(frame);
      this.syncReplayTime(true);
    }
  }

  jumpToShot(shotId) {
    const frame = this.playerRef?.jumpToShot(shotId);
    if (frame) {
      this.applyFrame(frame);
      this.syncReplayTime(true);
    }
  }

  exit() {
    this.playerRef = null;
    useGameStore.getState().stopReplayMode();
    resetInputHud();
  }

  setPointerLocked() {}
  onPointerMove(event) {
    if (!this.cameraDrag) return;
    const dx = event.clientX - this.cameraDrag.x;
    const dy = event.clientY - this.cameraDrag.y;
    this.cameraDrag.x = event.clientX;
    this.cameraDrag.y = event.clientY;
    if (this.cameraDrag.pan) {
      const scale = this.cameraDistance * 0.0018;
      const right = new Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
      const up = new Vector3(0, 1, 0);
      this.cameraTarget.addScaledVector(right, -dx * scale);
      this.cameraTarget.addScaledVector(up, dy * scale);
      this.cameraTarget.x = clamp(this.cameraTarget.x, -5, 5);
      this.cameraTarget.y = clamp(this.cameraTarget.y, -2.8, 4);
      this.cameraTarget.z = clamp(this.cameraTarget.z, -7, 7);
    } else {
      this.cameraYaw -= dx * 0.006;
      this.cameraPitch = clamp(this.cameraPitch + dy * 0.0045, minReplayPitch, maxReplayPitch);
    }
    event.preventDefault?.();
  }
  onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
    this.cameraDrag = { x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 2 };
    event.preventDefault?.();
  }
  onPointerUp() {
    this.cameraDrag = null;
  }
  onWheel(event) {
    if (useGameStore.getState().mode !== 'replay') return;
    this.cameraDistance = clamp(this.cameraDistance * (1 + event.deltaY * 0.001), minReplayDistance, maxReplayDistance);
    event.preventDefault?.();
  }
  onKeyDown(event) {
    if (event.code === 'Space') {
      const store = useGameStore.getState();
      store.setReplayPlaying(!store.replayPlaying);
      event.preventDefault();
    } else if (event.code === 'KeyR') {
      this.resetCamera();
    }
  }
  onKeyUp() {}

  applyFrame(frame) {
    if (!frame) return;
    const flip = this.viewerSide === 'p2' ? -1 : 1;
    const localIsP1 = this.viewerSide !== 'p2';
    const playerX = localIsP1 ? frame.p1.x : frame.p2.x;
    const aiX = localIsP1 ? frame.p2.x : frame.p1.x;
    this.player.prevX = this.player.x;
    this.ai.prevX = this.ai.x;
    this.player.x = playerX * flip;
    this.ai.x = aiX * flip;
    this.player.vx = this.player.x - this.player.prevX;
    this.ai.vx = this.ai.x - this.ai.prevX;
    this.player.tell = localIsP1 ? frame.p1.charge : frame.p2.charge;
    this.ai.tell = localIsP1 ? frame.p2.charge : frame.p1.charge;
    this.ball.set(frame.ball.x * flip, frame.ball.y, frame.ball.z * flip);
    this.vel.set(frame.velocity.x * flip, frame.velocity.y, frame.velocity.z * flip);
    this.spin.top = frame.spin.top;
    this.spin.side = frame.spin.side * flip;
    updateShadow(this.shadow, this.ball, TABLE);
    inputHud.charge = this.player.tell;
    inputHud.charging = false;
    inputHud.exchange = frame.exchange || 0;
    resetMarker(this.marker);
    this.aim.op = 0;

    const match = this.playerRef?.replay?.match;
    const scoreP = localIsP1 ? frame.score.p1 : frame.score.p2;
    const scoreAI = localIsP1 ? frame.score.p2 : frame.score.p1;
    const server = frame.server === this.viewerSide ? 'player' : 'ai';
    const winner = !match?.winner ? null : match.winner === this.viewerSide ? 'player' : 'ai';
    useGameStore.setState({
      scoreP,
      scoreAI,
      server,
      phase: frame.phase === 'waiting' ? 'serve' : frame.phase,
      winner: frame.phase === 'over' ? winner : null,
    });
  }

  update(dt, time) {
    dt = clampDt(dt);
    const store = useGameStore.getState();
    if (store.mode !== 'replay' || !this.playerRef) return;
    if (store.replayPlaying) {
      const next = this.playerRef.cursorMs + dt * 1000 * store.replaySpeed;
      const reachedEnd = next >= this.playerRef.durationMs;
      this.seek(next, false);
      this.syncReplayTime(reachedEnd);
      if (reachedEnd) useGameStore.getState().setReplayPlaying(false);
    }
    for (const racket of [this.player, this.ai]) {
      const sign = racket.who === 'player' ? 1 : -1;
      racket.y = damp(racket.y, 0.62 + racket.tell * 0.25, 8, dt);
      racket.z = racket.baseZ;
      racket.flash = Math.max(0, racket.flash - dt * 4);
      racket.rotX = (racket.who === 'player' ? -0.22 : 0.22) + racket.tell * sign * 0.18;
      racket.rotZ = damp(racket.rotZ, clamp(-racket.vx * 0.12, -0.45, 0.45), 10, dt);
    }
    this.ballRotX -= (2 + this.spin.top * 16) * dt;
    this.ballRotY += this.spin.side * 14 * dt;
    arenaFx.heat = damp(arenaFx.heat, clamp(0.12 + (inputHud.exchange || 0) * 0.05, 0, 0.8), 2, dt);
    arenaFx.serveCharge = 0;
    arenaFx.exchangeN = inputHud.exchange || 0;
    decayFx(dt);
    this.netWobble = Math.max(0, this.netWobble - dt * 2.2);
    this.netRotX = Math.sin(time * 26) * this.netWobble * 0.1;
    const cosPitch = Math.cos(this.cameraPitch);
    const targetX = this.cameraTarget.x + Math.sin(this.cameraYaw) * cosPitch * this.cameraDistance;
    const targetY = this.cameraTarget.y + Math.sin(this.cameraPitch) * this.cameraDistance;
    const targetZ = this.cameraTarget.z + Math.cos(this.cameraYaw) * cosPitch * this.cameraDistance;
    this.camX = damp(this.camX, targetX, 9, dt);
    this.camY = damp(this.camY, targetY, 9, dt);
    this.camZ = damp(this.camZ, targetZ, 9, dt);
    this.camLX = damp(this.camLX, this.cameraTarget.x, 9, dt);
    this.camLY = damp(this.camLY, this.cameraTarget.y, 9, dt);
    this.camLZ = damp(this.camLZ, this.cameraTarget.z, 9, dt);
    this.camFov = damp(this.camFov, 50, 2.4, dt);
  }
}

export const replayGame = new ReplayGame();
