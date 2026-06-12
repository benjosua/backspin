import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyElo, DEFAULT_RATING } from "./elo.js";

export type RankedUser = {
  id: string;
  email: string;
  name: string;
  password: string;
};

export type RankedProfile = {
  userId: string;
  email: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
};

export type LeaderboardEntry = RankedProfile & { rank: number };

type MatchInput = {
  roomId: string;
  p1UserId: string;
  p2UserId: string;
  p1Score: number;
  p2Score: number;
  winnerUserId: string;
  endedReason: string;
};

export interface RankedStore {
  init(): Promise<void>;
  findUserByEmail(email: string): Promise<RankedUser | null>;
  findUserById(id: string): Promise<RankedUser | null>;
  createUser(email: string, password: string, name: string): Promise<RankedUser>;
  updateUserName(userId: string, name: string): Promise<RankedUser>;
  getProfile(userId: string): Promise<RankedProfile>;
  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
  recordMatch(input: MatchInput): Promise<{ recorded: boolean; p1Delta: number; p2Delta: number }>;
  resetForTests?(): Promise<void>;
}

const normalizeEmail = (email: string) => String(email || "").trim().toLowerCase();
const normalizeName = (name: string, fallback: string) => String(name || fallback || "PLAYER").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "PLAYER";

function profileRow(row: any): RankedProfile {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    rating: Number(row.rating),
    wins: Number(row.wins),
    losses: Number(row.losses),
    gamesPlayed: Number(row.games_played),
  };
}

class PostgresRankedStore implements RankedStore {
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
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text UNIQUE NOT NULL,
        name text NOT NULL,
        password text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS ranked_profiles (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        rating integer NOT NULL DEFAULT 1200,
        wins integer NOT NULL DEFAULT 0,
        losses integer NOT NULL DEFAULT 0,
        games_played integer NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ranked_matches (
        room_id text PRIMARY KEY,
        p1_user_id text NOT NULL REFERENCES users(id),
        p2_user_id text NOT NULL REFERENCES users(id),
        p1_score integer NOT NULL,
        p2_score integer NOT NULL,
        winner_user_id text NOT NULL REFERENCES users(id),
        p1_rating_before integer NOT NULL,
        p2_rating_before integer NOT NULL,
        p1_delta integer NOT NULL,
        p2_delta integer NOT NULL,
        ended_reason text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async findUserByEmail(email: string) {
    await this.init();
    const result = await this.pool.query("SELECT id, email, name, password FROM users WHERE email = $1", [normalizeEmail(email)]);
    return result.rows[0] ?? null;
  }

  async findUserById(id: string) {
    await this.init();
    const result = await this.pool.query("SELECT id, email, name, password FROM users WHERE id = $1", [id]);
    return result.rows[0] ?? null;
  }

  async createUser(email: string, password: string, name: string) {
    await this.init();
    const id = randomUUID();
    const cleanEmail = normalizeEmail(email);
    const cleanName = normalizeName(name, cleanEmail.split("@")[0]);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO users (id, email, name, password) VALUES ($1, $2, $3, $4) RETURNING id, email, name, password",
        [id, cleanEmail, cleanName, password],
      );
      await client.query("INSERT INTO ranked_profiles (user_id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateUserName(userId: string, name: string) {
    await this.init();
    const current = await this.findUserById(userId);
    if (!current) throw new Error("user_not_found");
    const cleanName = normalizeName(name, current.email.split("@")[0]);
    const result = await this.pool.query(
      "UPDATE users SET name = $2 WHERE id = $1 RETURNING id, email, name, password",
      [userId, cleanName],
    );
    return result.rows[0];
  }

  async getProfile(userId: string) {
    await this.init();
    await this.pool.query("INSERT INTO ranked_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
    const result = await this.pool.query(`
      SELECT p.user_id, u.email, u.name, p.rating, p.wins, p.losses, p.games_played
      FROM ranked_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1
    `, [userId]);
    if (!result.rows[0]) throw new Error("user_not_found");
    return profileRow(result.rows[0]);
  }

  async leaderboard(limit: number) {
    await this.init();
    const result = await this.pool.query(`
      SELECT p.user_id, u.email, u.name, p.rating, p.wins, p.losses, p.games_played,
        rank() OVER (ORDER BY p.rating DESC, p.wins DESC, p.games_played ASC, u.name ASC) AS rank
      FROM ranked_profiles p JOIN users u ON u.id = p.user_id
      ORDER BY p.rating DESC, p.wins DESC, p.games_played ASC, u.name ASC
      LIMIT $1
    `, [Math.max(1, Math.min(100, limit || 50))]);
    return result.rows.map((row) => ({ ...profileRow(row), rank: Number(row.rank) }));
  }

  async recordMatch(input: MatchInput) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const seen = await client.query("SELECT room_id FROM ranked_matches WHERE room_id = $1", [input.roomId]);
      if (seen.rowCount) {
        await client.query("COMMIT");
        return { recorded: false, p1Delta: 0, p2Delta: 0 };
      }
      const profiles = await client.query(
        "SELECT user_id, rating FROM ranked_profiles WHERE user_id = ANY($1::text[]) FOR UPDATE",
        [[input.p1UserId, input.p2UserId]],
      );
      const byId = new Map(profiles.rows.map((row) => [row.user_id, Number(row.rating)]));
      const p1Before = byId.get(input.p1UserId) ?? DEFAULT_RATING;
      const p2Before = byId.get(input.p2UserId) ?? DEFAULT_RATING;
      const p1Won = input.winnerUserId === input.p1UserId;
      const elo = p1Won ? applyElo(p1Before, p2Before) : applyElo(p2Before, p1Before);
      const p1Delta = p1Won ? elo.winnerDelta : elo.loserDelta;
      const p2Delta = p1Won ? elo.loserDelta : elo.winnerDelta;

      await client.query(
        `UPDATE ranked_profiles SET rating = rating + $2, wins = wins + $3, losses = losses + $4, games_played = games_played + 1 WHERE user_id = $1`,
        [input.p1UserId, p1Delta, p1Won ? 1 : 0, p1Won ? 0 : 1],
      );
      await client.query(
        `UPDATE ranked_profiles SET rating = rating + $2, wins = wins + $3, losses = losses + $4, games_played = games_played + 1 WHERE user_id = $1`,
        [input.p2UserId, p2Delta, p1Won ? 0 : 1, p1Won ? 1 : 0],
      );
      await client.query(
        `INSERT INTO ranked_matches (room_id, p1_user_id, p2_user_id, p1_score, p2_score, winner_user_id, p1_rating_before, p2_rating_before, p1_delta, p2_delta, ended_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [input.roomId, input.p1UserId, input.p2UserId, input.p1Score, input.p2Score, input.winnerUserId, p1Before, p2Before, p1Delta, p2Delta, input.endedReason],
      );
      await client.query("COMMIT");
      return { recorded: true, p1Delta, p2Delta };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

class MemoryRankedStore implements RankedStore {
  private users = new Map<string, RankedUser>();
  private usersByEmail = new Map<string, string>();
  private profiles = new Map<string, Omit<RankedProfile, "email" | "name">>();
  private matches = new Set<string>();

  async init() {}

  async resetForTests() {
    this.users.clear();
    this.usersByEmail.clear();
    this.profiles.clear();
    this.matches.clear();
  }

  async findUserByEmail(email: string) {
    const id = this.usersByEmail.get(normalizeEmail(email));
    return id ? this.users.get(id) ?? null : null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async createUser(email: string, password: string, name: string) {
    const cleanEmail = normalizeEmail(email);
    if (this.usersByEmail.has(cleanEmail)) throw new Error("email_already_in_use");
    const user = { id: randomUUID(), email: cleanEmail, name: normalizeName(name, cleanEmail.split("@")[0]), password };
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    this.profiles.set(user.id, { userId: user.id, rating: DEFAULT_RATING, wins: 0, losses: 0, gamesPlayed: 0 });
    return user;
  }

  async updateUserName(userId: string, name: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error("user_not_found");
    user.name = normalizeName(name, user.email.split("@")[0]);
    this.users.set(user.id, user);
    return user;
  }

  async getProfile(userId: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error("user_not_found");
    if (!this.profiles.has(userId)) this.profiles.set(userId, { userId, rating: DEFAULT_RATING, wins: 0, losses: 0, gamesPlayed: 0 });
    const p = this.profiles.get(userId)!;
    return { ...p, email: user.email, name: user.name };
  }

  async leaderboard(limit: number) {
    const rows = await Promise.all([...this.profiles.keys()].map((id) => this.getProfile(id)));
    return rows
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.gamesPlayed - b.gamesPlayed || a.name.localeCompare(b.name))
      .slice(0, Math.max(1, Math.min(100, limit || 50)))
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  async recordMatch(input: MatchInput) {
    if (this.matches.has(input.roomId)) return { recorded: false, p1Delta: 0, p2Delta: 0 };
    this.matches.add(input.roomId);
    const p1 = await this.getProfile(input.p1UserId);
    const p2 = await this.getProfile(input.p2UserId);
    const p1Won = input.winnerUserId === input.p1UserId;
    const elo = p1Won ? applyElo(p1.rating, p2.rating) : applyElo(p2.rating, p1.rating);
    const p1Delta = p1Won ? elo.winnerDelta : elo.loserDelta;
    const p2Delta = p1Won ? elo.loserDelta : elo.winnerDelta;
    this.profiles.set(input.p1UserId, { userId: input.p1UserId, rating: p1.rating + p1Delta, wins: p1.wins + (p1Won ? 1 : 0), losses: p1.losses + (p1Won ? 0 : 1), gamesPlayed: p1.gamesPlayed + 1 });
    this.profiles.set(input.p2UserId, { userId: input.p2UserId, rating: p2.rating + p2Delta, wins: p2.wins + (p1Won ? 0 : 1), losses: p2.losses + (p1Won ? 1 : 0), gamesPlayed: p2.gamesPlayed + 1 });
    return { recorded: true, p1Delta, p2Delta };
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL is required for ranked accounts in production");
}

export const rankedStore: RankedStore = connectionString ? new PostgresRankedStore(connectionString) : new MemoryRankedStore();
