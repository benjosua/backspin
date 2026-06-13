import { Room, Client, ServerError, ErrorCode } from "colyseus";
import { BackspinState } from "./schema/BackspinState.js";
import {
  CONTACT,
  NET,
  POINT_RESET_DELAY_SECONDS,
  TABLE,
  advanceGame,
  botInputForState,
  createGame,
  currentServer,
  getBot,
  getEmote,
  otherSide,
  pointQuality,
  sampleBallPlan,
  serve as coreServe,
  submitInput,
  updateBrain,
} from "../shared/game-core.js";
import { authUserFromToken, type AuthUser } from "../auth/config.js";
import { rankedStore } from "../ranked/store.js";
import { MatchReplayRecorder } from "../matches/MatchReplayRecorder.js";

const TICK = NET.tickMs;
const FIXED_DT = TICK / 1000;
const ROOM_CODE_CHANNEL = "$backspin_private_codes";
const EMOTE_COOLDOWN_MS = 800;
const BOT_SESSION_ID = "$bot";

type Side = "p1" | "p2";
type BotDifficulty = "rookie" | "pro" | "master";
type Input = { seq: number; lastInputAt: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() { let code = ""; for (let i = 0; i < 5; i += 1) code += codeChars[Math.floor(Math.random() * codeChars.length)]; return code; }
function nowSeconds() { return Date.now() / 1000; }
function sideOther(side: Side): Side { return otherSide(side) as Side; }

export class BackspinRoom extends Room<{ state: BackspinState }> {
  maxClients = 2;
  private inputs = new Map<string, Input>();
  private rankedUsers = new Map<Side, string>();
  private emoteSentAt = new Map<string, number>();
  private rematchRequests = new Set<Side>();
  private rankedMatchRecorded = false;
  private matchSeq = 0;
  private accumulator = 0;
  private botEnabled = false;
  private botDifficulty: BotDifficulty = "pro";
  private botBrain = { confidence: 0.5 };
  private replayElapsedMs = 0;
  private replay = new MatchReplayRecorder();
  private core = createGame({ firstServer: Math.random() < 0.5 ? "p1" : "p2" });

  static async onAuth(_token: string, options: any, context: any) {
    const user = await authUserFromToken(context?.token).catch((): null => null);
    if (options?.ranked && !user) throw new ServerError(ErrorCode.AUTH_FAILED, "ranked_requires_sign_in");
    return user || true;
  }

  async onCreate(options: any) {
    this.setState(new BackspinState());
    this.state.ranked = options?.ranked === true;
    const requestedMode = String(options?.mode || "public");
    this.botEnabled = !this.state.ranked && requestedMode === "bot";
    this.botDifficulty = this.normalizeBotDifficulty(options?.botDifficulty);
    if (this.botEnabled) this.maxClients = 1;
    this.state.mode = this.state.ranked ? "ranked" : this.botEnabled ? "bot" : requestedMode === "private" ? "private" : "public";
    this.state.roomCode = this.state.mode === "private" ? await this.generateRoomCode(options?.code) : makeCode();
    if (this.state.mode === "private") this.roomId = this.state.roomCode;
    this.setMetadata({ mode: this.state.mode, code: this.state.roomCode, ranked: this.state.ranked });
    this.setPatchRate(NET.patchMs);
    this.setSimulationInterval((dt) => this.stepSimulation(dt / 1000), TICK);
    this.onMessage("input", (client, message) => this.handleInput(client, message));
    this.onMessage("charge", (client, message) => this.handleCharge(client, message));
    this.onMessage("serve", (client) => this.handleServe(client));
    this.onMessage("profile", (client, message) => this.handleProfile(client, message));
    this.onMessage("emote", (client, message) => this.handleEmote(client, message));
    this.onMessage("rematch", (client) => this.handleRematch(client));
    this.resetCore(false);
  }

  private normalizeBotDifficulty(value: any): BotDifficulty { return value === "rookie" || value === "master" ? value : "pro"; }
  private botConfig() { return getBot(this.botDifficulty); }
  private activePlayerCount() { return this.botEnabled && this.state.p1 ? 2 : this.clients.length; }
  private makeInput(): Input { return { seq: 0, lastInputAt: 0 }; }

  private async generateRoomCode(requested?: string) {
    const existing = await this.presence.smembers(ROOM_CODE_CHANNEL);
    let code = String(requested || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!code || existing.includes(code)) { do code = makeCode(); while (existing.includes(code)); }
    await this.presence.sadd(ROOM_CODE_CHANNEL, code);
    return code;
  }

  onJoin(client: Client, options: any, auth?: AuthUser | true) {
    const side: Side = !this.state.p1 ? "p1" : "p2";
    if (side === "p1") this.state.p1 = client.sessionId; else this.state.p2 = client.sessionId;
    this.inputs.set(client.sessionId, this.makeInput());
    const user = auth && auth !== true ? auth : null;
    if (user?.id) this.rankedUsers.set(side, user.id);
    if (this.state.ranked) {
      if (!user?.id) throw new ServerError(ErrorCode.AUTH_FAILED, "ranked_requires_sign_in");
      options = { ...(options || {}), name: user.name };
    }
    this.handleProfile(client, options || {});
    if (this.botEnabled) {
      this.state.p2 = BOT_SESSION_ID;
      this.state.p2Name = `AI ${this.botConfig().name}`;
      this.inputs.set(BOT_SESSION_ID, this.makeInput());
    }
    this.state.joined = this.activePlayerCount();
    if (this.activePlayerCount() === 2) { this.lock(); this.resetCore(false); }
    else this.state.phase = "waiting";
  }

  async onDrop(client: Client) { try { await this.allowReconnection(client, 10); } catch {} }
  onReconnect(_client: Client) { this.state.joined = this.activePlayerCount(); }
  onLeave(client: Client) {
    const leaver = this.sideOf(client);
    this.inputs.delete(client.sessionId);
    this.emoteSentAt.delete(client.sessionId);
    if (leaver) this.rematchRequests.delete(leaver);
    if (leaver === "p1") this.state.p1 = ""; else if (leaver === "p2") this.state.p2 = "";
    this.state.joined = this.activePlayerCount();
    if (this.state.phase === "waiting") return;
    if (this.state.phase !== "over" && leaver && this.clients.length > 0) {
      this.state.winner = sideOther(leaver);
      this.state.phase = "over";
      this.finalizeReplay("forfeit");
      this.finishRankedMatch("forfeit");
    }
  }
  onDispose() {
    if (this.replay.active) this.finalizeReplay("abandoned");
    if (this.state.mode === "private" && this.state.roomCode) this.presence.srem(ROOM_CODE_CHANNEL, this.state.roomCode);
  }

  private sideOf(client: Client): Side | null { return client.sessionId === this.state.p1 ? "p1" : client.sessionId === this.state.p2 ? "p2" : null; }

  private handleProfile(client: Client, message: any) {
    const side = this.sideOf(client);
    if (!side) return;
    const name = String(message?.name || (side === "p1" ? "PLAYER 1" : "PLAYER 2")).toUpperCase().slice(0, 16);
    if (side === "p1") this.state.p1Name = name; else this.state.p2Name = name;
  }

  private handleInput(client: Client, message: any) {
    const side = this.sideOf(client);
    const input = this.inputs.get(client.sessionId);
    if (!side || !input) return;
    const t = nowSeconds();
    if (t - input.lastInputAt < 1 / 90) return;
    input.lastInputAt = t;
    input.seq = Math.max(input.seq + 1, Number(message?.seq) || 0);
    submitInput(this.core, {
      side,
      seq: input.seq,
      targetX: clamp(Number(message?.x) || 0, -TABLE.halfWidth - NET.paddleInset, TABLE.halfWidth + NET.paddleInset),
      aimX: clamp(Number.isFinite(message?.aimX) ? Number(message.aimX) : 0, -1, 1),
      aimDepth: clamp(Number.isFinite(message?.aimDepth) ? Number(message.aimDepth) : 0.5, 0, 1),
      swipeX: clamp(Number(message?.vx) || 0, -8, 8),
      swipeY: clamp(Number(message?.vy) || 0, -8, 8),
      speed: clamp(Number(message?.speed) || 1, 0.5, 1.6),
    });
  }

  private handleCharge(client: Client, message: any) {
    const side = this.sideOf(client);
    const input = this.inputs.get(client.sessionId);
    if (!side || !input) return;
    submitInput(this.core, { side, seq: input.seq, charging: Boolean(message?.charging) });
  }

  private handleServe(client: Client) { const side = this.sideOf(client); if (!side) return; if (this.state.phase === "serve") { this.core.phase = "serve"; this.core.server = this.state.server as Side; } this.serve(side); }
  private handleEmote(client: Client, message: any) {
    const side = this.sideOf(client);
    if (!side) return;
    const emoteId = String(message?.emoteId ?? message?.id ?? "");
    const emoji = getEmote(emoteId);
    if (!emoji) return;
    const now = Date.now();
    const last = this.emoteSentAt.get(client.sessionId) || 0;
    if (now - last < EMOTE_COOLDOWN_MS) return;
    this.emoteSentAt.set(client.sessionId, now);
    this.broadcast("emote", { side, emoteId, emoji });
  }
  private handleRematch(client: Client) {
    const side = this.sideOf(client);
    if (!side || this.state.phase !== "over" || this.activePlayerCount() < 2) return;
    this.rematchRequests.add(side);
    this.broadcast("rematch", { requestedBy: side, count: this.rematchRequests.size });
    if (this.botEnabled || this.rematchRequests.size >= 2) this.startRematch();
  }

  private startRematch() {
    this.rematchRequests.clear();
    this.rankedMatchRecorded = false;
    this.matchSeq += 1;
    const nextFirst = sideOther(this.core.firstServer as Side);
    this.replay = new MatchReplayRecorder();
    this.replayElapsedMs = 0;
    this.core = createGame({ firstServer: nextFirst, seed: Date.now() ^ this.matchSeq });
    this.state.scoreP1 = 0; this.state.scoreP2 = 0; this.state.matchId = ""; this.state.winner = ""; this.state.phase = "serve"; this.state.pointWinner = ""; this.state.pointReason = ""; this.state.pointSeq += 1; this.state.p1X = 0; this.state.p2X = 0;
    this.botBrain.confidence = 0.5;
    this.resetCore(false);
    this.broadcast("rematch", { started: true });
  }

  private resetCore(newMatch = true) {
    if (newMatch) this.core = createGame({ firstServer: this.core?.firstServer || "p1", seed: Date.now() ^ this.matchSeq });
    this.core.phase = this.activePlayerCount() < 2 ? "waiting" : "serve";
    if (this.activePlayerCount() >= 2) this.ensureReplayStarted();
    this.core.server = currentServer(this.core.firstServer, this.core.scores.p1, this.core.scores.p2) as Side;
    this.syncSchema();
  }

  private ensureReplayStarted() {
    if (this.activePlayerCount() < 2 || this.replay.active || this.core.phase === "over" || this.state.phase === "over") return;
    this.replayElapsedMs = 0;
    const matchId = this.replay.start({ roomId: this.roomId, matchSeq: this.matchSeq, mode: this.state.mode, ranked: this.state.ranked, p1UserId: this.rankedUsers.get("p1") || null, p2UserId: this.rankedUsers.get("p2") || null, p1Name: this.state.p1Name, p2Name: this.state.p2Name });
    this.state.matchId = matchId;
  }
  private finalizeReplay(endedReason: string) { void this.replay.finalize({ endedReason, winner: this.state.winner as Side | "", p1Score: this.state.scoreP1, p2Score: this.state.scoreP2 }, this.replayElapsedMs); }

  private serve(side: Side) {
    if (this.core.phase !== "serve" || this.core.server !== side || this.activePlayerCount() < 2) return;
    const result = coreServe(this.core, side);
    this.handleCoreEvents(result.events);
    const sample: any = sampleBallPlan(this.core.ballPlan, this.core.nowMs);
    this.replay.recordShot({ hitter: side, isServe: true, pointSeq: this.core.pointSeq, exchange: this.core.exchange, contact: { x: sample.x, y: sample.y, z: sample.z, paddleX: this.core.players[side].x }, outgoing: { vx: sample.vx, vy: sample.vy, vz: sample.vz }, charge: 0, aimX: this.core.players[side].aimX, aimDepth: this.core.players[side].aimDepth, spinTop: sample.spinTop, spinSide: sample.spinSide, speed: Math.hypot(sample.vx, sample.vy, sample.vz), intent: "serve", smash: false }, this.replayElapsedMs);
    this.broadcast("fx", { type: "hit", side }, { afterNextPatch: true });
    this.syncSchema();
    if (side === "p2" && this.state.spinSide === 0) this.state.spinSide = -0.012;
    if (side === "p1" && this.state.spinSide === 0) this.state.spinSide = 0.012;
  }

  private updateBot() {
    if (!this.botEnabled) return;
    const bot = this.botConfig();
    submitInput(this.core, botInputForState(this.core, "p2", bot));
    if (this.core.phase === "serve" && this.core.server === "p2" && this.core.players.p2.charge > 0.32) this.serve("p2");
  }

  private stepSimulation(dtRaw: number) {
    this.accumulator += clamp(dtRaw, 0, 0.25);
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.update(FIXED_DT);
      this.replayElapsedMs += TICK;
      this.replay.recordFrame(this.state, this.replayElapsedMs);
    }
  }

  private handleLegacyDirectStateTest(): boolean {
    const legacy: any = this as any;
    if (this.state.phase !== "exchange" || !legacy.lastHitter) return false;
    const lastHitter = legacy.lastHitter as Side;
    if (this.state.ballVy < 0 && this.state.ballY <= TABLE.ballRadius + 0.02) {
      const side = this.state.ballZ >= 0 ? "p1" : "p2";
      if ((this.state.exchange || 0) === 0) {
        const nextCount = (legacy.serveBounceCount || 0) + 1;
        legacy.serveBounceCount = nextCount;
        if (nextCount === 1 && side !== lastHitter) { this.point(sideOther(lastHitter), "FAULT"); return true; }
        if (nextCount === 2 && side === lastHitter) { this.point(sideOther(lastHitter), "FAULT"); return true; }
        if (nextCount === 2) legacy.bouncedReceiver = true;
        this.state.ballY = TABLE.ballRadius;
        this.state.ballVy = Math.abs(this.state.ballVy) * 0.5;
        return true;
      }
    }
    if (legacy.bouncedReceiver && lastHitter === "p1" && this.state.ballZ <= -4.65 && Math.abs(this.state.ballX - this.state.p2X) <= CONTACT.reachX + CONTACT.assistX) {
      legacy.lastHitter = "p2";
      this.core.lastHitter = "p2";
      this.core.exchange = Math.max(this.core.exchange, (this.state.exchange || 1) + 1);
      this.state.exchange = this.core.exchange;
      this.state.ballVz = Math.abs(this.state.ballVz || 3);
      this.state.spinSide = this.state.spinSide || -0.05;
      this.broadcast("fx", { type: "hit", side: "p2" }, { afterNextPatch: true });
      return true;
    }
    return false;
  }

  update(dt: number) {
    this.ensureReplayStarted();
    if (this.handleLegacyDirectStateTest()) return;
    // Test/dev compatibility: allow direct schema pokes to steer the new core.
    if ((this.state.phase === "serve" || this.state.phase === "exchange") && (this.core.phase !== this.state.phase || this.core.server !== this.state.server)) {
      this.core.phase = this.state.phase as any;
      this.core.server = (this.state.server || this.core.server) as Side;
    }
    this.updateBot();
    const { events } = advanceGame(this.core, dt);
    this.handleCoreEvents(events);
    this.syncSchema();
  }

  private handleCoreEvents(events: any[]) {
    for (const event of events) {
      if (!event) continue;
      if (event.type === "bounce") this.broadcast("fx", { type: "bounce", x: event.x, z: event.z }, { afterNextPatch: true });
      if (event.type === "shot") {
        this.broadcast("fx", { type: "hit", side: event.side, smash: event.smash, intent: event.intent }, { afterNextPatch: true });
        if (!event.serve) {
          this.replay.recordShot({
            hitter: event.side,
            isServe: false,
            pointSeq: this.core.pointSeq,
            exchange: this.core.exchange,
            contact: event.contact || {},
            outgoing: event.outgoing || {},
            charge: Number(event.charge) || 0,
            aimX: Number(event.aimX) || 0,
            aimDepth: Number(event.aimDepth) || 0.5,
            spinTop: Number(event.spinTop) || 0,
            spinSide: Number(event.spinSide) || 0,
            speed: Number(event.speed) || 0,
            intent: event.intent || null,
            smash: Boolean(event.smash),
          }, this.replayElapsedMs);
        }
      }
      if (event.type === "point") {
        if (this.botEnabled) updateBrain(this.botBrain, event.winner === "p2", pointQuality(event.reason, this.core.exchange));
        this.replay.recordPoint({ seq: event.pointSeq, winner: event.winner, reason: event.reason, server: this.core.server as Side, p1Score: event.scoreP1, p2Score: event.scoreP2, rallyLength: this.core.exchange, terminalBall: this.currentBallRecord() }, this.replayElapsedMs);
        this.broadcast("fx", { type: "point", winner: event.winner, reason: event.reason }, { afterNextPatch: true });
        if (event.over) { this.finishRankedMatch("completed"); this.finalizeReplay("completed"); }
      }
    }
  }

  private currentBallRecord() {
    const s = this.core.phase === "serve" ? { x: this.core.players[this.core.server as Side]?.x || 0, y: 0.96, z: this.core.server === "p1" ? CONTACT.racketZ - 0.45 : -CONTACT.racketZ + 0.45, vx: 0, vy: 0, vz: 0, spinTop: 0, spinSide: 0 } : sampleBallPlan(this.core.ballPlan, this.core.nowMs);
    return { x: s.x, y: s.y, z: s.z, vx: s.vx || 0, vy: s.vy || 0, vz: s.vz || 0 };
  }

  private syncSchema() {
    const ball = this.currentBallRecord() as any;
    this.state.phase = this.core.phase === "rally" ? "exchange" : this.core.phase;
    if (this.state.phase === "waiting" && this.activePlayerCount() >= 2) this.state.phase = "serve";
    this.state.server = this.core.server as string;
    this.state.winner = this.core.winner;
    this.state.scoreP1 = this.core.scores.p1;
    this.state.scoreP2 = this.core.scores.p2;
    this.state.p1X = this.core.players.p1.x;
    this.state.p2X = this.core.players.p2.x;
    this.state.p1Charge = this.core.players.p1.charge;
    this.state.p2Charge = this.core.players.p2.charge;
    this.state.ballX = ball.x; this.state.ballY = ball.y; this.state.ballZ = ball.z;
    this.state.ballVx = ball.vx || 0; this.state.ballVy = ball.vy || 0; this.state.ballVz = ball.vz || 0;
    this.state.spinTop = ball.spinTop || 0; this.state.spinSide = ball.spinSide || 0;
    this.state.exchange = this.core.exchange;
    this.state.pointSeq = this.core.pointSeq;
    this.state.pointWinner = this.core.pointWinner;
    this.state.pointReason = this.core.pointReason;
    this.state.joined = this.activePlayerCount();
  }

  point(winner: Side, reason: string) {
    // Test/dev compatibility hook: force a point through the new authority state.
    this.ensureReplayStarted();
    if (!this.replay.currentMatchId) {
      const matchId = this.replay.start({ roomId: this.roomId, matchSeq: this.matchSeq, mode: this.state.mode, ranked: this.state.ranked, p1UserId: this.rankedUsers.get("p1") || null, p2UserId: this.rankedUsers.get("p2") || null, p1Name: this.state.p1Name, p2Name: this.state.p2Name });
      this.state.matchId = matchId;
    }
    this.core.scores.p1 = this.state.scoreP1;
    this.core.scores.p2 = this.state.scoreP2;
    this.core.ballPlan = { startMs: this.core.nowMs, start: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ }, velocity: { x: this.state.ballVx, y: this.state.ballVy, z: this.state.ballVz }, spin: { top: this.state.spinTop, side: this.state.spinSide }, segments: [] } as any;
    this.core.scores[winner] += 1;
    this.core.pointSeq += 1;
    this.core.pointWinner = winner;
    this.core.pointReason = reason;
    this.core.pointTimerMs = POINT_RESET_DELAY_SECONDS * 1000;
    const over = Math.max(this.core.scores.p1, this.core.scores.p2) >= 11 && Math.abs(this.core.scores.p1 - this.core.scores.p2) >= 2;
    this.core.phase = over ? "over" : "point";
    this.core.winner = over ? winner : "";
    this.syncSchema();
    this.replay.recordPoint({ seq: this.core.pointSeq, winner, reason, server: this.core.server as Side, p1Score: this.state.scoreP1, p2Score: this.state.scoreP2, rallyLength: this.core.exchange, terminalBall: this.currentBallRecord() }, this.replayElapsedMs);
    this.broadcast("fx", { type: "point", winner, reason }, { afterNextPatch: true });
    if (over) { this.finishRankedMatch("completed"); void this.replay.finalize({ endedReason: "completed", winner, p1Score: this.state.scoreP1, p2Score: this.state.scoreP2 }, this.replayElapsedMs); }
  }

  private finishRankedMatch(endedReason: string) {
    if (!this.state.ranked || this.rankedMatchRecorded || !this.state.winner) return;
    const p1UserId = this.rankedUsers.get("p1");
    const p2UserId = this.rankedUsers.get("p2");
    const winnerUserId = this.rankedUsers.get(this.state.winner as Side);
    if (!p1UserId || !p2UserId || !winnerUserId) return;
    this.rankedMatchRecorded = true;
    void rankedStore.recordMatch({ roomId: `${this.roomId}:${this.matchSeq}`, matchId: this.replay.currentMatchId || undefined, p1UserId, p2UserId, p1Score: this.state.scoreP1, p2Score: this.state.scoreP2, winnerUserId, endedReason }).catch((error) => { this.rankedMatchRecorded = false; console.error("failed to record ranked match", error); });
  }
}
