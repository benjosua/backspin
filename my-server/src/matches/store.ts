import { randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import pg from "pg";

export type Side = "p1" | "p2";

export type MatchCreateInput = {
  id?: string;
  roomId: string;
  matchSeq: number;
  mode: string;
  ranked: boolean;
  p1UserId?: string | null;
  p2UserId?: string | null;
  p1Name: string;
  p2Name: string;
  startedAt?: Date;
};

export type MatchFinishInput = {
  matchId: string;
  endedAt?: Date;
  endedReason: string;
  winner?: Side | "" | null;
  p1Score: number;
  p2Score: number;
  durationMs: number;
  totalPoints: number;
  totalShots: number;
};

export type ReplayFrame = number[];

export type ReplayChunkInput = {
  matchId: string;
  chunkIndex: number;
  startMs: number;
  endMs: number;
  frames: ReplayFrame[];
};

export type ShotInput = {
  id: string;
  matchId: string;
  seq: number;
  timeMs: number;
  pointSeq: number;
  exchange: number;
  hitter: Side;
  isServe: boolean;
  contact: Record<string, unknown>;
  outgoing: Record<string, unknown>;
  charge: number;
  aimX: number;
  aimDepth: number;
  spinTop: number;
  spinSide: number;
  speed: number;
  intent?: string | null;
  smash?: boolean;
};

export type PointInput = {
  id: string;
  matchId: string;
  seq: number;
  timeMs: number;
  winner: Side;
  reason: string;
  server: Side;
  p1Score: number;
  p2Score: number;
  rallyLength: number;
  terminalBall: Record<string, unknown>;
};

export type MatchSummary = {
  id: string;
  roomId: string;
  matchSeq: number;
  mode: string;
  ranked: boolean;
  p1UserId: string | null;
  p2UserId: string | null;
  p1Name: string;
  p2Name: string;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  winner: string | null;
  p1Score: number;
  p2Score: number;
  durationMs: number;
  totalPoints: number;
  totalShots: number;
};

export type MatchShot = Omit<ShotInput, "contact" | "outgoing"> & {
  contact: Record<string, unknown>;
  outgoing: Record<string, unknown>;
};

export type MatchPoint = PointInput;

export type MatchDetails = {
  match: MatchSummary;
  stats: {
    totalPoints: number;
    totalShots: number;
    aces: number;
    faults: number;
    winners: number;
    smashes: number;
    longestRally: number;
  };
  points: MatchPoint[];
  shots: MatchShot[];
};

export type MatchListItem = Pick<MatchDetails, "match" | "stats"> & {
  viewerSide: Side;
  replayReady: boolean;
};

export type MatchReplay = MatchDetails & {
  chunks: ReplayChunkInput[];
};

export type ShotReplay = {
  match: MatchSummary;
  shot: MatchShot;
  frames: ReplayFrame[];
};

export interface MatchStore {
  init(): Promise<void>;
  createMatch(input: MatchCreateInput): Promise<MatchSummary>;
  finishMatch(input: MatchFinishInput): Promise<void>;
  addPoint(input: PointInput): Promise<void>;
  addShot(input: ShotInput): Promise<void>;
  addReplayChunk(input: ReplayChunkInput): Promise<void>;
  getMatchDetails(matchId: string): Promise<MatchDetails | null>;
  getReplay(matchId: string): Promise<MatchReplay | null>;
  getShotReplay(matchId: string, shotId: string): Promise<ShotReplay | null>;
  listMatchesForUser(userId: string, limit: number, offset: number): Promise<MatchListItem[]>;
  resetForTests?(): Promise<void>;
}

const asIso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const roundInt = (value: number) => Math.max(0, Math.round(Number(value) || 0));

function makeSummary(row: any): MatchSummary {
  return {
    id: row.id,
    roomId: row.room_id,
    matchSeq: Number(row.match_seq),
    mode: row.mode,
    ranked: Boolean(row.ranked),
    p1UserId: row.p1_user_id ?? null,
    p2UserId: row.p2_user_id ?? null,
    p1Name: row.p1_name,
    p2Name: row.p2_name,
    startedAt: asIso(row.started_at)!,
    endedAt: asIso(row.ended_at),
    endedReason: row.ended_reason ?? null,
    winner: row.winner ?? null,
    p1Score: Number(row.p1_score || 0),
    p2Score: Number(row.p2_score || 0),
    durationMs: Number(row.duration_ms || 0),
    totalPoints: Number(row.total_points || 0),
    totalShots: Number(row.total_shots || 0),
  };
}

function makePoint(row: any): MatchPoint {
  return {
    id: row.id,
    matchId: row.match_id,
    seq: Number(row.seq),
    timeMs: Number(row.time_ms),
    winner: row.winner,
    reason: row.reason,
    server: row.server,
    p1Score: Number(row.p1_score),
    p2Score: Number(row.p2_score),
    rallyLength: Number(row.rally_length),
    terminalBall: row.terminal_ball || {},
  };
}

function makeShot(row: any): MatchShot {
  return {
    id: row.id,
    matchId: row.match_id,
    seq: Number(row.seq),
    timeMs: Number(row.time_ms),
    pointSeq: Number(row.point_seq),
    exchange: Number(row.exchange),
    hitter: row.hitter,
    isServe: Boolean(row.is_serve),
    contact: row.contact || {},
    outgoing: row.outgoing || {},
    charge: Number(row.charge || 0),
    aimX: Number(row.aim_x || 0),
    aimDepth: Number(row.aim_depth || 0),
    spinTop: Number(row.spin_top || 0),
    spinSide: Number(row.spin_side || 0),
    speed: Number(row.speed || 0),
    intent: row.intent ?? null,
    smash: Boolean(row.smash),
  };
}

function stats(points: MatchPoint[], shots: MatchShot[]) {
  return {
    totalPoints: points.length,
    totalShots: shots.length,
    aces: points.filter((point) => point.reason === "WINNER" && point.rallyLength === 0).length,
    faults: points.filter((point) => point.reason === "FAULT").length,
    winners: points.filter((point) => point.reason === "WINNER").length,
    smashes: shots.filter((shot) => shot.smash).length,
    longestRally: points.reduce((max, point) => Math.max(max, point.rallyLength), 0),
  };
}

class PostgresMatchStore implements MatchStore {
  private pool: pg.Pool;
  private ready?: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  init() {
    this.ready ||= this.migrate();
    return this.ready;
  }

  private async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id text PRIMARY KEY,
        room_id text NOT NULL,
        match_seq integer NOT NULL,
        mode text NOT NULL,
        ranked boolean NOT NULL DEFAULT false,
        p1_user_id text NULL,
        p2_user_id text NULL,
        p1_name text NOT NULL,
        p2_name text NOT NULL,
        started_at timestamptz NOT NULL,
        ended_at timestamptz NULL,
        ended_reason text NULL,
        winner text NULL,
        p1_score integer NOT NULL DEFAULT 0,
        p2_score integer NOT NULL DEFAULT 0,
        duration_ms integer NOT NULL DEFAULT 0,
        total_points integer NOT NULL DEFAULT 0,
        total_shots integer NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS matches_room_idx ON matches(room_id, match_seq);

      CREATE TABLE IF NOT EXISTS match_points (
        id text PRIMARY KEY,
        match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        seq integer NOT NULL,
        time_ms integer NOT NULL,
        winner text NOT NULL,
        reason text NOT NULL,
        server text NOT NULL,
        p1_score integer NOT NULL,
        p2_score integer NOT NULL,
        rally_length integer NOT NULL,
        terminal_ball jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS match_points_match_idx ON match_points(match_id, seq);

      CREATE TABLE IF NOT EXISTS match_shots (
        id text PRIMARY KEY,
        match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        seq integer NOT NULL,
        time_ms integer NOT NULL,
        point_seq integer NOT NULL,
        exchange integer NOT NULL,
        hitter text NOT NULL,
        is_serve boolean NOT NULL,
        contact jsonb NOT NULL DEFAULT '{}'::jsonb,
        outgoing jsonb NOT NULL DEFAULT '{}'::jsonb,
        charge double precision NOT NULL DEFAULT 0,
        aim_x double precision NOT NULL DEFAULT 0,
        aim_depth double precision NOT NULL DEFAULT 0,
        spin_top double precision NOT NULL DEFAULT 0,
        spin_side double precision NOT NULL DEFAULT 0,
        speed double precision NOT NULL DEFAULT 0,
        intent text NULL,
        smash boolean NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS match_shots_match_idx ON match_shots(match_id, seq);

      CREATE TABLE IF NOT EXISTS match_replay_chunks (
        match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        chunk_index integer NOT NULL,
        start_ms integer NOT NULL,
        end_ms integer NOT NULL,
        frame_count integer NOT NULL,
        data bytea NOT NULL,
        PRIMARY KEY (match_id, chunk_index)
      );
    `);
  }

  async createMatch(input: MatchCreateInput) {
    await this.init();
    const id = input.id || randomUUID();
    const startedAt = input.startedAt || new Date();
    const result = await this.pool.query(
      `INSERT INTO matches (id, room_id, match_seq, mode, ranked, p1_user_id, p2_user_id, p1_name, p2_name, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [id, input.roomId, input.matchSeq, input.mode, input.ranked, input.p1UserId || null, input.p2UserId || null, input.p1Name, input.p2Name, startedAt],
    );
    if (result.rows[0]) return makeSummary(result.rows[0]);
    const existing = await this.pool.query("SELECT * FROM matches WHERE id = $1", [id]);
    return makeSummary(existing.rows[0]);
  }

  async finishMatch(input: MatchFinishInput) {
    await this.init();
    await this.pool.query(
      `UPDATE matches SET ended_at = $2, ended_reason = $3, winner = $4, p1_score = $5, p2_score = $6,
        duration_ms = $7, total_points = $8, total_shots = $9
       WHERE id = $1`,
      [input.matchId, input.endedAt || new Date(), input.endedReason, input.winner || null, input.p1Score, input.p2Score, roundInt(input.durationMs), input.totalPoints, input.totalShots],
    );
  }

  async addPoint(input: PointInput) {
    await this.init();
    await this.pool.query(
      `INSERT INTO match_points (id, match_id, seq, time_ms, winner, reason, server, p1_score, p2_score, rally_length, terminal_ball)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.matchId, input.seq, roundInt(input.timeMs), input.winner, input.reason, input.server, input.p1Score, input.p2Score, input.rallyLength, input.terminalBall],
    );
  }

  async addShot(input: ShotInput) {
    await this.init();
    await this.pool.query(
      `INSERT INTO match_shots (id, match_id, seq, time_ms, point_seq, exchange, hitter, is_serve, contact, outgoing, charge, aim_x, aim_depth, spin_top, spin_side, speed, intent, smash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.matchId, input.seq, roundInt(input.timeMs), input.pointSeq, input.exchange, input.hitter, input.isServe, input.contact, input.outgoing, input.charge, input.aimX, input.aimDepth, input.spinTop, input.spinSide, input.speed, input.intent || null, Boolean(input.smash)],
    );
  }

  async addReplayChunk(input: ReplayChunkInput) {
    await this.init();
    const data = gzipSync(Buffer.from(JSON.stringify(input.frames)));
    await this.pool.query(
      `INSERT INTO match_replay_chunks (match_id, chunk_index, start_ms, end_ms, frame_count, data)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (match_id, chunk_index) DO NOTHING`,
      [input.matchId, input.chunkIndex, input.startMs, input.endMs, input.frames.length, data],
    );
  }

  async getMatchDetails(matchId: string) {
    await this.init();
    const matchResult = await this.pool.query("SELECT * FROM matches WHERE id = $1", [matchId]);
    if (!matchResult.rows[0]) return null;
    const [pointResult, shotResult] = await Promise.all([
      this.pool.query("SELECT * FROM match_points WHERE match_id = $1 ORDER BY seq", [matchId]),
      this.pool.query("SELECT * FROM match_shots WHERE match_id = $1 ORDER BY seq", [matchId]),
    ]);
    const points = pointResult.rows.map(makePoint);
    const shots = shotResult.rows.map(makeShot);
    return { match: makeSummary(matchResult.rows[0]), stats: stats(points, shots), points, shots };
  }

  async getReplay(matchId: string) {
    const details = await this.getMatchDetails(matchId);
    if (!details) return null;
    const chunksResult = await this.pool.query("SELECT * FROM match_replay_chunks WHERE match_id = $1 ORDER BY chunk_index", [matchId]);
    const chunks = chunksResult.rows.map((row) => ({
      matchId: row.match_id,
      chunkIndex: Number(row.chunk_index),
      startMs: Number(row.start_ms),
      endMs: Number(row.end_ms),
      frames: JSON.parse(gunzipSync(row.data).toString("utf8")) as ReplayFrame[],
    }));
    return { ...details, chunks };
  }

  async getShotReplay(matchId: string, shotId: string) {
    const replay = await this.getReplay(matchId);
    if (!replay) return null;
    const shot = replay.shots.find((item) => item.id === shotId);
    if (!shot) return null;
    const from = Math.max(0, shot.timeMs - 250);
    const nextShot = replay.shots.find((item) => item.seq === shot.seq + 1);
    const nextPoint = replay.points.find((item) => item.seq >= shot.pointSeq && item.timeMs > shot.timeMs);
    const until = Math.min(nextShot?.timeMs ?? Number.POSITIVE_INFINITY, nextPoint?.timeMs ?? Number.POSITIVE_INFINITY, shot.timeMs + 3000);
    const frames = replay.chunks.flatMap((chunk) => chunk.frames).filter((frame) => frame[0] >= from && frame[0] <= until);
    return { match: replay.match, shot, frames };
  }

  async listMatchesForUser(userId: string, limit: number, offset: number) {
    await this.init();
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const result = await this.pool.query(
      `SELECT m.*, EXISTS (
         SELECT 1 FROM match_replay_chunks c WHERE c.match_id = m.id LIMIT 1
       ) AS replay_ready
       FROM matches m
       WHERE m.ended_at IS NOT NULL AND (m.p1_user_id = $1 OR m.p2_user_id = $1)
       ORDER BY m.ended_at DESC, m.started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset],
    );
    return Promise.all(result.rows.map(async (row) => {
      const details = await this.getMatchDetails(row.id);
      if (!details) return null;
      return {
        match: details.match,
        stats: details.stats,
        viewerSide: details.match.p1UserId === userId ? "p1" as Side : "p2" as Side,
        replayReady: Boolean(row.replay_ready),
      };
    })).then((items) => items.filter(Boolean) as MatchListItem[]);
  }
}

class MemoryMatchStore implements MatchStore {
  private matches = new Map<string, MatchSummary>();
  private points = new Map<string, MatchPoint[]>();
  private shots = new Map<string, MatchShot[]>();
  private chunks = new Map<string, ReplayChunkInput[]>();

  async init() {}

  async resetForTests() {
    this.matches.clear();
    this.points.clear();
    this.shots.clear();
    this.chunks.clear();
  }

  async createMatch(input: MatchCreateInput) {
    const id = input.id || randomUUID();
    const match: MatchSummary = {
      id,
      roomId: input.roomId,
      matchSeq: input.matchSeq,
      mode: input.mode,
      ranked: input.ranked,
      p1UserId: input.p1UserId || null,
      p2UserId: input.p2UserId || null,
      p1Name: input.p1Name,
      p2Name: input.p2Name,
      startedAt: (input.startedAt || new Date()).toISOString(),
      endedAt: null,
      endedReason: null,
      winner: null,
      p1Score: 0,
      p2Score: 0,
      durationMs: 0,
      totalPoints: 0,
      totalShots: 0,
    };
    this.matches.set(id, match);
    this.points.set(id, []);
    this.shots.set(id, []);
    this.chunks.set(id, []);
    return match;
  }

  async finishMatch(input: MatchFinishInput) {
    const match = this.matches.get(input.matchId);
    if (!match) return;
    this.matches.set(input.matchId, {
      ...match,
      endedAt: (input.endedAt || new Date()).toISOString(),
      endedReason: input.endedReason,
      winner: input.winner || null,
      p1Score: input.p1Score,
      p2Score: input.p2Score,
      durationMs: roundInt(input.durationMs),
      totalPoints: input.totalPoints,
      totalShots: input.totalShots,
    });
  }

  async addPoint(input: PointInput) {
    const rows = this.points.get(input.matchId) || [];
    if (!rows.some((row) => row.id === input.id)) rows.push({ ...input });
    this.points.set(input.matchId, rows.sort((a, b) => a.seq - b.seq));
  }

  async addShot(input: ShotInput) {
    const rows = this.shots.get(input.matchId) || [];
    if (!rows.some((row) => row.id === input.id)) rows.push({ ...input, intent: input.intent || null, smash: Boolean(input.smash) });
    this.shots.set(input.matchId, rows.sort((a, b) => a.seq - b.seq));
  }

  async addReplayChunk(input: ReplayChunkInput) {
    const rows = this.chunks.get(input.matchId) || [];
    if (!rows.some((row) => row.chunkIndex === input.chunkIndex)) rows.push({ ...input, frames: input.frames.map((frame) => [...frame]) });
    this.chunks.set(input.matchId, rows.sort((a, b) => a.chunkIndex - b.chunkIndex));
  }

  async getMatchDetails(matchId: string) {
    const match = this.matches.get(matchId);
    if (!match) return null;
    const points = [...(this.points.get(matchId) || [])];
    const shots = [...(this.shots.get(matchId) || [])];
    return { match, stats: stats(points, shots), points, shots };
  }

  async getReplay(matchId: string) {
    const details = await this.getMatchDetails(matchId);
    if (!details) return null;
    return { ...details, chunks: [...(this.chunks.get(matchId) || [])] };
  }

  async getShotReplay(matchId: string, shotId: string) {
    const replay = await this.getReplay(matchId);
    if (!replay) return null;
    const shot = replay.shots.find((item) => item.id === shotId);
    if (!shot) return null;
    const from = Math.max(0, shot.timeMs - 250);
    const nextShot = replay.shots.find((item) => item.seq === shot.seq + 1);
    const nextPoint = replay.points.find((item) => item.seq >= shot.pointSeq && item.timeMs > shot.timeMs);
    const until = Math.min(nextShot?.timeMs ?? Number.POSITIVE_INFINITY, nextPoint?.timeMs ?? Number.POSITIVE_INFINITY, shot.timeMs + 3000);
    const frames = replay.chunks.flatMap((chunk) => chunk.frames).filter((frame) => frame[0] >= from && frame[0] <= until);
    return { match: replay.match, shot, frames };
  }

  async listMatchesForUser(userId: string, limit: number, offset: number) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    return [...this.matches.values()]
      .filter((match) => match.endedAt && (match.p1UserId === userId || match.p2UserId === userId))
      .sort((a, b) => String(b.endedAt || b.startedAt).localeCompare(String(a.endedAt || a.startedAt)))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((match) => {
        const points = [...(this.points.get(match.id) || [])];
        const shots = [...(this.shots.get(match.id) || [])];
        return {
          match,
          stats: stats(points, shots),
          viewerSide: match.p1UserId === userId ? "p1" as Side : "p2" as Side,
          replayReady: Boolean((this.chunks.get(match.id) || []).length),
        };
      });
  }
}

const connectionString = process.env.DATABASE_URL;
export const matchStore: MatchStore = connectionString ? new PostgresMatchStore(connectionString) : new MemoryMatchStore();
