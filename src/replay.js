const replayBaseUrl = import.meta.env.VITE_COLYSEUS_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:2567');
const replayHttpBase = String(replayBaseUrl).replace(/^ws/i, 'http').replace(/\/$/, '');

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
