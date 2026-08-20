import { Vector3 } from 'three';
import { CAMERA, COLORS } from './constants.js';
import { clampDt, damp, resetFx } from './fx-state.js';
import { inputHud, resetInputHud } from './view-state.js';
import { useGameStore } from './store.js';
import { applyGameplayFx, assignDriverViewState, clearAimAndProjection, isIncoming, triggerPaddleHitAnimation, updateArenaVisuals, updateBallVisuals, updateReplayPaddles } from './game-driver-view.js';
import { clamp, flipPoint } from '../serve/src/shared/game-core.js';

const replayDevBackendUrl = (import.meta.env.DEV && typeof window !== 'undefined')
  ? `${window.location.protocol}//${window.location.hostname}:2567`
  : '';
const replayBaseUrl = import.meta.env.VITE_COLYSEUS_URL || replayDevBackendUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:2567');
const replayHttpBase = String(replayBaseUrl).replace(/^ws/i, 'http').replace(/\/$/, '');
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

function replayEventTime(event) {
  return Math.max(0, Math.round(Number(event?.timeMs) || 0));
}

function replayEventId(event, index) {
  return event?.id || `${event?.type || 'event'}:${event?.seq ?? index}:${replayEventTime(event)}`;
}

function buildReplayEvents(replay) {
  const events = (replay?.events || []).map((event, index) => ({ ...event, replayKey: replayEventId(event, index) }));
  const shots = (replay?.shots || []).map((shot, index) => ({ ...shot, type: 'shot', replayKey: replayEventId(shot, index) }));
  const points = (replay?.points || []).map((point, index) => ({ ...point, type: 'point', replayKey: replayEventId(point, index) }));
  return [...events, ...shots, ...points].sort((a, b) => replayEventTime(a) - replayEventTime(b) || (a.seq || 0) - (b.seq || 0) || (a.type === 'shot' ? -1 : 1));
}

function upperBoundReplayEvents(events, timeMs) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (replayEventTime(events[mid]) <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class ServerReplayPlayer {
  constructor(replay) {
    this.replay = replay;
    this.frames = flattenReplayFrames(replay);
    this.points = replay?.points || [];
    this.shots = replay?.shots || [];
    this.durationMs = this.frames.at(-1)?.[0] || replay?.match?.durationMs || 0;
    this.events = buildReplayEvents(replay);
    this.eventCursor = 0;
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

  seek(timeMs, { resetEvents = true } = {}) {
    if (!this.frames.length) return null;
    this.cursorMs = Math.max(0, Math.min(this.durationMs, Number(timeMs) || 0));
    if (resetEvents) this.eventCursor = upperBoundReplayEvents(this.events, this.cursorMs);
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

  consumeEventsUntil(timeMs) {
    const out = [];
    const until = Math.max(0, Math.round(Number(timeMs) || 0));
    while (this.eventCursor < this.events.length && replayEventTime(this.events[this.eventCursor]) <= until) {
      out.push(this.events[this.eventCursor]);
      this.eventCursor += 1;
    }
    return out;
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
    assignDriverViewState(this, 'replay');
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
    this.fx = null;
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
      const initialFrame = player.current;
      const localIsP1 = side !== 'p2';
      useGameStore.getState().startReplayMode({
        match,
        stats: player.replay?.stats || null,
        viewerSide: side,
        durationMs: player.durationMs,
        scoreP: localIsP1 ? initialFrame?.score.p1 : initialFrame?.score.p2,
        scoreAI: localIsP1 ? initialFrame?.score.p2 : initialFrame?.score.p1,
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

  sideColor(side) {
    return side === this.viewerSide ? COLORS.player : COLORS.ai;
  }

  winnerIsLocal(side) {
    return side === this.viewerSide;
  }

  mapReplaySide(side) {
    return side === this.viewerSide ? 'player' : 'ai';
  }

  mapEventSideToRacket(side) {
    return this.mapReplaySide(side);
  }

  mapReplayPoint(point) {
    return flipPoint(point, this.viewerSide === 'p2' ? -1 : 1);
  }

  applyReplayEvent(event) {
    if (!event) return;
    if (event.type === 'bounce') {
      const payload = event.payload || {};
      const point = this.mapReplayPoint({ x: payload.x, y: 0, z: payload.z });
      applyGameplayFx(this, { type: 'bounce', x: point?.x || 0, z: point?.z || 0 }, { playAudio: true });
      return;
    }
    if (event.type === 'net') {
      applyGameplayFx(this, { type: 'net' }, { playAudio: true });
      return;
    }
    if (event.type === 'emote') {
      const payload = event.payload || {};
      const side = this.mapReplaySide(payload.side);
      const emoji = payload.emoji;
      if (emoji) useGameStore.getState().showEmote(side, emoji);
      return;
    }
    if (event.type === 'shot') {
      const contact = this.mapReplayPoint(event.contact);
      triggerPaddleHitAnimation(this, event.hitter, { smash: event.smash, contact });
      applyGameplayFx(this, { type: 'shot', side: event.hitter, smash: event.smash }, {
        exchange: event.exchange || 0,
        sideColor: (shotSide) => this.sideColor(shotSide),
        winnerIsLocal: (winner) => this.winnerIsLocal(winner),
        pointLabel: '',
        playAudio: true,
      });
      return;
    }
    if (event.type === 'point') {
      const terminal = this.mapReplayPoint(event.terminalBall);
      if (terminal) this.ball.set(terminal.x, terminal.y, terminal.z);
      applyGameplayFx(this, { type: 'point', winner: event.winner }, {
        exchange: event.rallyLength || inputHud.exchange || 0,
        sideColor: (side) => this.sideColor(side),
        winnerIsLocal: (winner) => this.winnerIsLocal(winner),
        pointLabel: event.reason || 'POINT',
        playAudio: true,
      });
    }
  }

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
    const ball = flipPoint(frame.ball, flip);
    this.ball.set(ball.x, ball.y, ball.z);
    const velocity = flipPoint(frame.velocity, flip);
    this.vel.set(velocity.x, velocity.y, velocity.z);
    this.spin.top = frame.spin.top;
    this.spin.side = frame.spin.side * flip;
    inputHud.charge = this.player.tell;
    inputHud.charging = false;
    inputHud.exchange = frame.exchange || 0;
    updateBallVisuals(this, 0);
    clearAimAndProjection(this);

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

  update(dt, time, _camera, effects) {
    this.fx = effects;
    dt = clampDt(dt);
    const store = useGameStore.getState();
    if (store.mode !== 'replay' || !this.playerRef) return;
    if (store.replayPlaying) {
      const next = this.playerRef.cursorMs + dt * 1000 * store.replaySpeed;
      const reachedEnd = next >= this.playerRef.durationMs;
      const frame = this.playerRef.seek(next, { resetEvents: false });
      if (frame) this.applyFrame(frame);
      for (const event of this.playerRef.consumeEventsUntil(this.playerRef.cursorMs)) this.applyReplayEvent(event);
      this.syncReplayTime(reachedEnd);
      if (reachedEnd) useGameStore.getState().setReplayPlaying(false);
    }
    const phase = useGameStore.getState().phase;
    const playerIncoming = isIncoming({ phase, velocity: this.vel }, 'player');
    const aiIncoming = isIncoming({ phase, velocity: this.vel }, 'ai');
    updateReplayPaddles(this, dt, { playerIncoming, aiIncoming });
    updateBallVisuals(this, dt);
    updateArenaVisuals(this, phase, inputHud.exchange || 0, 0, dt, time, { replay: true });
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
