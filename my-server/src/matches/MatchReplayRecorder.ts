import { randomUUID } from "node:crypto";
import { matchStore, type MatchStore, type ReplayFrame, type Side } from "./store.js";
import type { BackspinState } from "../rooms/schema/BackspinState.js";

const CHUNK_FRAME_LIMIT = 300;
const CHUNK_MS_LIMIT = 5000;

type StartInput = {
  roomId: string;
  matchSeq: number;
  mode: string;
  ranked: boolean;
  p1UserId?: string | null;
  p2UserId?: string | null;
  p1Name: string;
  p2Name: string;
};

type ShotRecordInput = {
  hitter: Side;
  isServe: boolean;
  pointSeq: number;
  exchange: number;
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

type PointRecordInput = {
  seq: number;
  winner: Side;
  reason: string;
  server: Side;
  p1Score: number;
  p2Score: number;
  rallyLength: number;
  terminalBall: Record<string, unknown>;
};

type FinishInput = {
  endedReason: string;
  winner?: Side | "" | null;
  p1Score: number;
  p2Score: number;
};

const n = (value: number) => Math.round((Number(value) || 0) * 10000) / 10000;
const wallElapsedMs = (startedAt: number) => Math.max(0, Math.round(Date.now() - startedAt));
const replayMs = (value: number) => Math.max(0, Math.round(Number(value) || 0));

export class MatchReplayRecorder {
  private store: MatchStore;
  private pending: Promise<unknown> = Promise.resolve();
  private startedAt = 0;
  private matchId: string | null = null;
  private chunkIndex = 0;
  private frameChunk: ReplayFrame[] = [];
  private shotSeq = 0;
  private pointSeq = 0;
  private finalized = false;

  constructor(store = matchStore) {
    this.store = store;
  }

  get currentMatchId() {
    return this.matchId;
  }

  get active() {
    return Boolean(this.matchId && !this.finalized);
  }

  start(input: StartInput) {
    if (this.active) return this.matchId!;
    this.startedAt = Date.now();
    this.matchId = randomUUID();
    this.chunkIndex = 0;
    this.frameChunk = [];
    this.shotSeq = 0;
    this.pointSeq = 0;
    this.finalized = false;
    const matchId = this.matchId;
    const startedAt = this.startedAt;
    this.enqueue(() => this.store.createMatch({ id: matchId, startedAt: new Date(startedAt), ...input }));
    return matchId;
  }

  recordFrame(state: BackspinState, timeMsInput = 0) {
    if (!this.active || !this.matchId) return;
    const timeMs = replayMs(timeMsInput);
    const frame: ReplayFrame = [
      timeMs,
      n(state.ballX), n(state.ballY), n(state.ballZ),
      n(state.ballVx), n(state.ballVy), n(state.ballVz),
      n(state.spinTop), n(state.spinSide),
      n(state.p1X), n(state.p2X),
      n(state.p1Charge), n(state.p2Charge),
      state.scoreP1, state.scoreP2,
      state.phase === "serve" ? 0 : state.phase === "exchange" ? 1 : state.phase === "point" ? 2 : state.phase === "over" ? 3 : -1,
      state.server === "p1" ? 1 : 2,
      state.exchange,
    ];
    this.frameChunk.push(frame);
    const first = this.frameChunk[0];
    if (this.frameChunk.length >= CHUNK_FRAME_LIMIT || (first && timeMs - first[0] >= CHUNK_MS_LIMIT)) this.flushChunk();
  }

  recordShot(input: ShotRecordInput, timeMsInput = 0) {
    if (!this.active || !this.matchId) return null;
    this.shotSeq += 1;
    const matchId = this.matchId;
    const seq = this.shotSeq;
    const timeMs = replayMs(timeMsInput);
    const id = `${matchId}:shot:${seq}`;
    const shot = { ...input, id, matchId, seq, timeMs };
    this.enqueue(() => this.store.addShot(shot));
    return id;
  }

  recordPoint(input: PointRecordInput, timeMsInput = 0) {
    if (!this.active || !this.matchId) return null;
    this.pointSeq += 1;
    const matchId = this.matchId;
    const seq = this.pointSeq;
    const timeMs = replayMs(timeMsInput);
    const id = `${matchId}:point:${seq}`;
    const point = { ...input, id, matchId, timeMs };
    this.enqueue(() => this.store.addPoint(point));
    return id;
  }

  finalize(input: FinishInput, durationMsInput?: number) {
    if (!this.active || !this.matchId) return this.whenIdle();
    this.flushChunk();
    const matchId = this.matchId;
    const durationMs = durationMsInput === undefined ? wallElapsedMs(this.startedAt) : replayMs(durationMsInput);
    const totalPoints = this.pointSeq;
    const totalShots = this.shotSeq;
    this.finalized = true;
    this.enqueue(() => this.store.finishMatch({
      matchId,
      endedAt: new Date(),
      endedReason: input.endedReason,
      winner: input.winner || null,
      p1Score: input.p1Score,
      p2Score: input.p2Score,
      durationMs,
      totalPoints,
      totalShots,
    }));
    return this.whenIdle();
  }

  whenIdle(): Promise<void> {
    return this.pending.then((): void => undefined);
  }

  private flushChunk() {
    if (!this.matchId || this.frameChunk.length === 0) return;
    const frames = this.frameChunk;
    const startMs = frames[0][0];
    const endMs = frames[frames.length - 1][0];
    const matchId = this.matchId;
    const chunkIndex = this.chunkIndex;
    this.chunkIndex += 1;
    this.frameChunk = [];
    this.enqueue(() => this.store.addReplayChunk({ matchId, chunkIndex, startMs, endMs, frames }));
  }

  private enqueue(work: () => Promise<unknown>) {
    this.pending = this.pending.then(work).catch((error) => {
      console.error("match replay persistence failed", error);
    });
  }
}
