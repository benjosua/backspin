import { Room, Client, ServerError, ErrorCode } from "colyseus";
import { BackspinState } from "./schema/BackspinState.js";
import { NET, TABLE as CORE_TABLE, PHYSICS as CORE_PHYSICS, getEmote, resolvePlayerShot, solveLegalServe, stepPaddleX } from "../shared/backspin-core.js";
import { getBot, makeBrain, resetBrain, updateBrain, resolveBotServe, resolveBotReturn, resolveBotPaddleTarget } from "../shared/backspin-bot.js";
import { otherSide as sharedOtherSide, currentServer as sharedCurrentServer, pointQuality as sharedPointQuality, resolveBouncePoint, resolveOutPoint } from "../shared/backspin-rules.js";
import { applyStateBounce, detectStateNet, detectStateRacketContact, isStateBallOnTable, stepBallState } from "../shared/backspin-physics.js";
import { authUserFromToken, type AuthUser } from "../auth/config.js";
import { rankedStore } from "../ranked/store.js";
import { MatchReplayRecorder } from "../matches/MatchReplayRecorder.js";

const TABLE = CORE_TABLE;
const PHYSICS = { ...CORE_PHYSICS, serveHeight: 0.95 };
const PADDLE_Z = { p1: 4.8, p2: -4.8 } as const;
const PADDLE_Y = 0.62;
const REACH = 0.95;
const TICK = NET.tickMs;
const PATCH_RATE = NET.patchMs;
const FIXED_DT = NET.tickMs / 1000;
const ROOM_CODE_CHANNEL = "$backspin_private_codes";
const EMOTE_COOLDOWN_MS = 800;

type Side = "p1" | "p2";
type BotDifficulty = "rookie" | "pro" | "master";
type Input = { targetX: number; targetY: number; aimX: number; aimDepth: number; vx: number; vy: number; speed: number; charging: boolean; chargeStartedAt: number; lastInputAt: number };
type BotConfig = ReturnType<typeof getBot>;
const BOT_SESSION_ID = "$bot";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const other = (side: Side): Side => sharedOtherSide(side) as Side;
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() {
  let code = "";
  for (let i = 0; i < 5; i += 1) code += codeChars[Math.floor(Math.random() * codeChars.length)];
  return code;
}
function nowSeconds() { return Date.now() / 1000; }
export class BackspinRoom extends Room<{ state: BackspinState }> {
  maxClients = 2;
  private inputs = new Map<string, Input>();
  private rankedUsers = new Map<Side, string>();
  private emoteSentAt = new Map<string, number>();
  private rematchRequests = new Set<Side>();
  private rankedMatchRecorded = false;
  private matchSeq = 0;
  private lastHitter: Side | null = null;
  private bouncedReceiver = false;
  private serveBounceCount = 0;
  private pointTimer = 0;
  private firstServer: Side = Math.random() < 0.5 ? "p1" : "p2";
  private accumulator = 0;
  private botEnabled = false;
  private botDifficulty: BotDifficulty = "pro";
  private botServeTimer = 0;
  private botBrain = makeBrain();
  private replayElapsedMs = 0;
  private replay = new MatchReplayRecorder();

  static async onAuth(_token: string, options: any, context: any) {
    const user = await authUserFromToken(context?.token).catch((_error: unknown): null => null);
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
    if (this.state.mode === "private") {
      this.state.roomCode = await this.generateRoomCode(options?.code);
      this.roomId = this.state.roomCode;
    } else {
      this.state.roomCode = makeCode();
    }
    this.state.server = this.firstServer;
    this.setMetadata({ mode: this.state.mode, code: this.state.roomCode, ranked: this.state.ranked });
    this.setPatchRate(PATCH_RATE);
    this.setSimulationInterval((dt) => this.stepSimulation(dt / 1000), TICK);

    this.onMessage("input", (client, message) => this.handleInput(client, message));
    this.onMessage("charge", (client, message) => this.handleCharge(client, message));
    this.onMessage("serve", (client) => this.handleServe(client));
    this.onMessage("profile", (client, message) => this.handleProfile(client, message));
    this.onMessage("emote", (client, message) => this.handleEmote(client, message));
    this.onMessage("rematch", (client) => this.handleRematch(client));
  }

  private normalizeBotDifficulty(value: any): BotDifficulty {
    return value === "rookie" || value === "master" ? value : "pro";
  }

  private botConfig(): BotConfig {
    return getBot(this.botDifficulty);
  }

  private activePlayerCount() {
    return this.botEnabled && this.state.p1 ? 2 : this.clients.length;
  }

  private makeInput(): Input {
    return { targetX: 0, targetY: 0, aimX: 0, aimDepth: 0.5, vx: 0, vy: 0, speed: 1, charging: false, chargeStartedAt: 0, lastInputAt: 0 };
  }

  private async generateRoomCode(requested?: string) {
    const existing = await this.presence.smembers(ROOM_CODE_CHANNEL);
    let code = String(requested || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!code || existing.includes(code)) {
      do code = makeCode();
      while (existing.includes(code));
    }
    await this.presence.sadd(ROOM_CODE_CHANNEL, code);
    return code;
  }

  onJoin(client: Client, options: any, auth?: AuthUser | true) {
    const side: Side = !this.state.p1 ? "p1" : "p2";
    if (side === "p1") this.state.p1 = client.sessionId;
    else this.state.p2 = client.sessionId;
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
    if (this.activePlayerCount() === 2) {
      this.lock();
      this.resetServe();
    } else {
      this.state.phase = "waiting";
    }
  }

  async onDrop(client: Client) {
    try {
      await this.allowReconnection(client, 10);
    } catch {
      // onLeave() will run if reconnection fails.
    }
  }

  onReconnect(_client: Client) {
    this.state.joined = this.activePlayerCount();
  }

  onLeave(client: Client) {
    const leaver = this.sideOf(client);
    this.inputs.delete(client.sessionId);
    this.emoteSentAt.delete(client.sessionId);
    if (leaver) this.rematchRequests.delete(leaver);
    if (leaver === "p1") this.state.p1 = "";
    else if (leaver === "p2") this.state.p2 = "";

    this.state.joined = this.activePlayerCount();
    if (this.state.phase === "waiting") return;

    if (this.state.phase !== "over" && leaver && this.clients.length > 0) {
      this.state.winner = other(leaver);
      this.state.phase = "over";
      this.finalizeReplay("forfeit");
      this.finishRankedMatch("forfeit");
    }
  }

  onDispose() {
    if (this.replay.active) this.finalizeReplay("abandoned");
    if (this.state.mode === "private" && this.state.roomCode) {
      this.presence.srem(ROOM_CODE_CHANNEL, this.state.roomCode);
    }
  }

  private sideOf(client: Client): Side | null {
    if (client.sessionId === this.state.p1) return "p1";
    if (client.sessionId === this.state.p2) return "p2";
    return null;
  }

  private handleProfile(client: Client, message: any) {
    const side = this.sideOf(client);
    if (!side) return;
    const name = String(message?.name || (side === "p1" ? "PLAYER 1" : "PLAYER 2")).toUpperCase().slice(0, 16);
    if (side === "p1") this.state.p1Name = name;
    else this.state.p2Name = name;
  }

  private handleInput(client: Client, message: any) {
    const input = this.inputs.get(client.sessionId);
    if (!input) return;
    const t = nowSeconds();
    if (t - input.lastInputAt < 1 / 75) return;
    input.lastInputAt = t;
    input.targetX = clamp(Number(message?.x) || 0, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
    input.targetY = clamp(Number(message?.y) || 0, -1, 1);
    input.aimX = clamp(Number.isFinite(message?.aimX) ? Number(message.aimX) : input.targetX / TABLE.halfWidth, -1, 1);
    input.aimDepth = clamp(Number.isFinite(message?.aimDepth) ? Number(message.aimDepth) : (input.targetY + 1) * 0.5, 0, 1);
    input.vx = clamp(Number(message?.vx) || 0, -8, 8);
    input.vy = clamp(Number(message?.vy) || 0, -8, 8);
    input.speed = clamp(Number(message?.speed) || 1, 0.5, 1.6);
  }

  private handleCharge(client: Client, message: any) {
    const input = this.inputs.get(client.sessionId);
    if (!input) return;
    const charging = Boolean(message?.charging);
    if (charging && !input.charging) input.chargeStartedAt = nowSeconds();
    input.charging = charging;
  }

  private handleEmote(client: Client, message: any) {
    const side = this.sideOf(client);
    if (!side) return;
    const emoteId = String(message?.emoteId ?? message?.id ?? "");
    const emoji = getEmote(emoteId);
    if (!emoji) return;
    const now = Date.now();
    const lastSentAt = this.emoteSentAt.get(client.sessionId) || 0;
    if (now - lastSentAt < EMOTE_COOLDOWN_MS) return;
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
    this.firstServer = other(this.firstServer);
    this.pointTimer = 0;
    this.accumulator = 0;
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.serveBounceCount = 0;
    this.state.scoreP1 = 0;
    this.state.scoreP2 = 0;
    this.state.matchId = "";
    this.state.winner = "";
    this.state.pointWinner = "";
    this.state.pointReason = "";
    this.state.pointSeq += 1;
    this.state.p1X = 0;
    this.state.p2X = 0;
    resetBrain(this.botBrain);
    for (const input of this.inputs.values()) {
      input.targetX = 0;
      input.targetY = 0;
      input.aimX = 0;
      input.aimDepth = 0.5;
      input.vx = 0;
      input.vy = 0;
      input.charging = false;
      input.chargeStartedAt = 0;
    }
    this.resetServe();
    this.broadcast("rematch", { started: true });
  }

  private ensureReplayStarted() {
    if (this.activePlayerCount() < 2 || this.replay.active) return;
    this.replayElapsedMs = 0;
    const matchId = this.replay.start({
      roomId: this.roomId,
      matchSeq: this.matchSeq,
      mode: this.state.mode,
      ranked: this.state.ranked,
      p1UserId: this.rankedUsers.get("p1") || null,
      p2UserId: this.rankedUsers.get("p2") || null,
      p1Name: this.state.p1Name,
      p2Name: this.state.p2Name,
    });
    this.state.matchId = matchId;
  }

  private finalizeReplay(endedReason: string) {
    void this.replay.finalize({
      endedReason,
      winner: this.state.winner as Side | "",
      p1Score: this.state.scoreP1,
      p2Score: this.state.scoreP2,
    }, this.replayElapsedMs);
  }

  private currentServer(): Side {
    return sharedCurrentServer(this.firstServer, this.state.scoreP1, this.state.scoreP2, sharedOtherSide) as Side;
  }

  private resetServe() {
    this.ensureReplayStarted();
    this.state.exchange = 0;
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.serveBounceCount = 0;
    this.state.ballVx = 0; this.state.ballVy = 0; this.state.ballVz = 0;
    this.state.spinTop = 0; this.state.spinSide = 0;
    this.state.p1Charge = 0; this.state.p2Charge = 0;
    this.state.server = this.currentServer();
    this.state.phase = this.activePlayerCount() < 2 ? "waiting" : "serve";
    const z = this.state.server === "p1" ? PADDLE_Z.p1 - 0.45 : PADDLE_Z.p2 + 0.45;
    const x = this.state.server === "p1" ? this.state.p1X : this.state.p2X;
    this.state.ballX = x; this.state.ballY = PADDLE_Y + 0.34; this.state.ballZ = z;
  }

  private handleServe(client: Client) {
    const side = this.sideOf(client);
    if (side) this.serve(side);
  }

  private serve(side: Side) {
    if (this.state.phase !== "serve" || this.state.server !== side || this.activePlayerCount() < 2) return;
    const zDir = side === "p1" ? -1 : 1;
    const x = side === "p1" ? this.state.p1X : this.state.p2X;
    const charge = side === "p1" ? this.state.p1Charge : this.state.p2Charge;
    const input = this.inputs.get(side === "p1" ? this.state.p1 : this.state.p2);
    this.state.ballX = x;
    this.state.ballY = PADDLE_Y + 0.34;
    this.state.ballZ = side === "p1" ? PADDLE_Z.p1 - 0.45 : PADDLE_Z.p2 + 0.45;
    const botServing = this.botEnabled && side === "p2";
    const top = clamp(((input?.vy || 0) * 0.18) + charge * 0.25, -0.8, 0.8);
    const sideSpin = clamp((input?.vx || 0) * 0.12, -0.8, 0.8);
    const aimX = input?.aimX || 0;
    const aimDepth = input?.aimDepth ?? 0.5;
    const targetX = clamp(aimX * TABLE.halfWidth * 0.96 + sideSpin * TABLE.halfWidth * 0.22, -TABLE.halfWidth * 0.98, TABLE.halfWidth * 0.98);
    const targetZ = zDir * (0.08 + aimDepth * 0.88) * TABLE.halfLength;
    const shot = botServing
      ? resolveBotServe({
          side,
          ball: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ },
          bot: this.botConfig(),
          brain: this.botBrain,
          botScore: this.state.scoreP2,
          opponentScore: this.state.scoreP1,
          opponentX: this.state.p1X,
          random: Math.random,
        })
      : solveLegalServe({ x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ }, targetX, targetZ, 0.72 - charge * 0.16, top, sideSpin, side);
    const v = shot.velocity;
    this.state.ballVx = v.x; this.state.ballVy = v.y; this.state.ballVz = v.z;
    this.state.spinTop = shot.topSpin; this.state.spinSide = shot.sideSpin;
    this.replay.recordShot({
      hitter: side,
      isServe: true,
      pointSeq: this.state.pointSeq,
      exchange: this.state.exchange,
      contact: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ, paddleX: x },
      outgoing: { vx: v.x, vy: v.y, vz: v.z },
      charge,
      aimX,
      aimDepth,
      spinTop: shot.topSpin,
      spinSide: shot.sideSpin,
      speed: Math.hypot(v.x, v.y, v.z),
      intent: "serve",
      smash: false,
    }, this.replayElapsedMs);
    this.lastHitter = side;
    this.bouncedReceiver = false;
    this.serveBounceCount = 0;
    this.state.phase = "exchange";
    this.broadcast("fx", { type: "hit", side }, { afterNextPatch: true });
  }

  private hit(side: Side) {
    const paddleX = side === "p1" ? this.state.p1X : this.state.p2X;
    const input = this.inputs.get(side === "p1" ? this.state.p1 : this.state.p2);
    const charge = side === "p1" ? this.state.p1Charge : this.state.p2Charge;
    const incomingVelocity = { x: this.state.ballVx, y: this.state.ballVy, z: this.state.ballVz };
    const offset = clamp((this.state.ballX - paddleX) / REACH, -1, 1);
    this.state.exchange += 1;
    const botHitting = this.botEnabled && side === "p2";
    const shot: any = botHitting
      ? resolveBotReturn({
          side,
          ball: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ },
          incomingVelocity,
          exchange: this.state.exchange,
          bot: this.botConfig(),
          brain: this.botBrain,
          botScore: this.state.scoreP2,
          opponentScore: this.state.scoreP1,
          opponentX: this.state.p1X,
          opponentVx: this.inputs.get(this.state.p1)?.vx || 0,
          random: Math.random,
        })
      : resolvePlayerShot(
          {
            side,
            ball: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ },
            incomingVelocity,
            offset,
            exchange: this.state.exchange,
          },
          {
            charge,
            chargeHeldMs: input?.charging ? Math.max(0, (nowSeconds() - input.chargeStartedAt) * 1000) : 0,
            charging: Boolean(input?.charging),
            swipeX: input?.vx || 0,
            swipeY: input?.vy || 0,
            aimX: input?.aimX || 0,
            aimDepth: input?.aimDepth ?? 0.5,
          },
          { random: Math.random },
        );
    const v = shot.velocity;
    this.state.ballVx = v.x; this.state.ballVy = v.y; this.state.ballVz = v.z;
    this.state.spinTop = shot.spin.top; this.state.spinSide = shot.spin.side;
    this.replay.recordShot({
      hitter: side,
      isServe: false,
      pointSeq: this.state.pointSeq,
      exchange: this.state.exchange,
      contact: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ, paddleX, offset, incomingVelocity },
      outgoing: { vx: v.x, vy: v.y, vz: v.z },
      charge,
      aimX: input?.aimX || 0,
      aimDepth: input?.aimDepth ?? 0.5,
      spinTop: shot.spin.top,
      spinSide: shot.spin.side,
      speed: Math.hypot(v.x, v.y, v.z),
      intent: botHitting ? (shot.smash ? "smash" : shot.lob ? "lob" : "drive") : shot.intent,
      smash: shot.smash,
    }, this.replayElapsedMs);
    this.lastHitter = side;
    this.bouncedReceiver = false;
    if (side === "p1") this.state.p1Charge = 0; else this.state.p2Charge = 0;
    const shotIntent = botHitting ? (shot.smash ? "smash" : shot.lob ? "lob" : "drive") : shot.intent;
    this.broadcast("fx", { type: "hit", side, smash: shot.smash, intent: shotIntent }, { afterNextPatch: true });
  }

  private point(winner: Side, reason: string) {
    if (this.state.phase !== "exchange" && this.state.phase !== "serve") return;
    this.state.phase = "point";
    this.pointTimer = 1;
    this.state.pointSeq += 1;
    this.state.pointWinner = winner;
    this.state.pointReason = reason;
    if (winner === "p1") this.state.scoreP1 += 1;
    else this.state.scoreP2 += 1;
    if (this.botEnabled) updateBrain(this.botBrain, winner === "p2", sharedPointQuality(reason, this.state.exchange));
    this.replay.recordPoint({
      seq: this.state.pointSeq,
      winner,
      reason,
      server: this.state.server as Side,
      p1Score: this.state.scoreP1,
      p2Score: this.state.scoreP2,
      rallyLength: this.state.exchange,
      terminalBall: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ, vx: this.state.ballVx, vy: this.state.ballVy, vz: this.state.ballVz },
    }, this.replayElapsedMs);
    this.broadcast("fx", { type: "point", winner, reason }, { afterNextPatch: true });
    if (Math.max(this.state.scoreP1, this.state.scoreP2) >= 11 && Math.abs(this.state.scoreP1 - this.state.scoreP2) >= 2) {
      this.state.phase = "over";
      this.state.winner = winner;
      this.finalizeReplay("completed");
      this.finishRankedMatch("completed");
    }
  }

  private finishRankedMatch(endedReason: string) {
    if (!this.state.ranked || this.rankedMatchRecorded || !this.state.winner) return;
    const p1UserId = this.rankedUsers.get("p1");
    const p2UserId = this.rankedUsers.get("p2");
    const winnerUserId = this.rankedUsers.get(this.state.winner as Side);
    if (!p1UserId || !p2UserId || !winnerUserId) return;
    this.rankedMatchRecorded = true;
    void rankedStore.recordMatch({
      roomId: `${this.roomId}:${this.matchSeq}`,
      matchId: this.replay.currentMatchId || undefined,
      p1UserId,
      p2UserId,
      p1Score: this.state.scoreP1,
      p2Score: this.state.scoreP2,
      winnerUserId,
      endedReason,
    }).catch((error) => {
      this.rankedMatchRecorded = false;
      console.error("failed to record ranked match", error);
    });
  }

  private predictBotContactX() {
    return resolveBotPaddleTarget({
      side: "p2",
      ball: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ },
      velocity: { x: this.state.ballVx, y: this.state.ballVy, z: this.state.ballVz },
      spin: { top: this.state.spinTop, side: this.state.spinSide },
      phase: this.state.phase,
      lastHitter: this.lastHitter,
      exchange: this.state.exchange,
      bot: this.botConfig(),
      currentX: this.state.p2X,
    });
  }

  private updateBotInput(dt: number) {
    if (!this.botEnabled) return;
    const input = this.inputs.get(BOT_SESSION_ID);
    if (!input) return;
    const bot = this.botConfig();
    input.speed = clamp(bot.paddleSpeed / NET.paddleSpeed, 0.5, 1.6);

    if (this.state.phase === "serve" && this.state.server === "p2") {
      this.botServeTimer += dt;
      input.targetX = clamp(Math.sin((this.state.pointSeq + 1) * 1.7) * TABLE.halfWidth * 0.25, -TABLE.halfWidth, TABLE.halfWidth);
      input.aimX = clamp(Math.sin((this.state.pointSeq + 2) * 1.31) * (0.2 + bot.placement * 0.45), -0.85, 0.85);
      input.aimDepth = clamp(0.42 + bot.aggression * 0.28, 0.32, 0.86);
      input.vx = clamp(input.aimX * 4 * bot.serveSpin, -8, 8);
      input.vy = clamp(0.7 * bot.serveSpin, -8, 8);
      if (!input.charging) input.chargeStartedAt = nowSeconds();
      input.charging = true;
      if (this.botServeTimer >= 0.45) {
        this.botServeTimer = 0;
        this.serve("p2");
        input.charging = false;
      }
      return;
    }

    this.botServeTimer = 0;
    const incoming = this.state.phase === "exchange" && this.state.ballVz < 0;
    const rawTarget = incoming ? this.predictBotContactX() : this.state.ballX * 0.25;
    const deterministicNoise = Math.sin((this.state.exchange + 1) * 2.17 + this.state.pointSeq * 0.73) * bot.error * TABLE.halfWidth;
    const target = clamp(rawTarget * (0.45 + bot.skill * 0.55) + deterministicNoise, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
    input.vx = clamp((target - this.state.p2X) * 3.2, -8, 8);
    input.targetX = target;
    input.aimX = clamp((-this.state.p1X / TABLE.halfWidth) * (0.25 + bot.placement * 0.65) + deterministicNoise * 0.08, -0.95, 0.95);
    input.aimDepth = clamp(0.4 + bot.aggression * 0.35, 0.25, 0.92);
    input.vy = clamp(bot.spin * 1.2, -8, 8);
    const wantsCharge = incoming && Math.abs(this.state.ballZ - PADDLE_Z.p2) < 2.4 && bot.aggression > 0.45;
    if (wantsCharge && !input.charging) input.chargeStartedAt = nowSeconds();
    input.charging = wantsCharge;
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

  private update(dt: number) {
    this.updateBotInput(dt);
    for (const [sessionId, input] of this.inputs) {
      const side = sessionId === this.state.p1 ? "p1" : sessionId === this.state.p2 ? "p2" : null;
      if (!side) continue;
      const current = side === "p1" ? this.state.p1X : this.state.p2X;
      const { x: next } = stepPaddleX(current, input.targetX, dt, input.speed);
      if (side === "p1") {
        this.state.p1X = next;
        this.state.p1Charge = input.charging ? clamp(this.state.p1Charge + dt * 0.95, 0, 1) : 0;
      } else {
        this.state.p2X = next;
        this.state.p2Charge = input.charging ? clamp(this.state.p2Charge + dt * 0.95, 0, 1) : 0;
      }
    }

    if (this.state.phase === "serve") {
      const x = this.state.server === "p1" ? this.state.p1X : this.state.p2X;
      this.state.ballX = x;
      this.state.ballY = PADDLE_Y + 0.34;
      this.state.ballZ = this.state.server === "p1" ? PADDLE_Z.p1 - 0.45 : PADDLE_Z.p2 + 0.45;
      return;
    }
    if (this.state.phase === "point") {
      this.pointTimer -= dt;
      if (this.pointTimer <= 0) this.resetServe();
      return;
    }
    if (this.state.phase !== "exchange") return;

    const prevX = this.state.ballX;
    const prevY = this.state.ballY;
    const prevZ = this.state.ballZ;
    stepBallState(this.state, dt);

    if (detectStateNet(prevZ, prevY, this.state) && this.lastHitter) {
      this.state.ballZ = Math.sign(prevZ) * 0.06;
      this.state.ballVz *= -0.12;
      this.point(other(this.lastHitter), "NET");
      return;
    }

    for (const side of ["p1", "p2"] as Side[]) {
      if (this.lastHitter === side || !this.bouncedReceiver) continue;
      const contact = detectStateRacketContact({
        side,
        prevX,
        prevY,
        prevZ,
        state: this.state,
        racketX: side === "p1" ? this.state.p1X : this.state.p2X,
        reach: REACH,
      });
      if (contact) {
        this.state.ballX = contact.x; this.state.ballY = contact.y; this.state.ballZ = contact.z;
        this.hit(side);
        return;
      }
    }

    if (this.state.ballVy < 0 && this.state.ballY <= TABLE.ballRadius) {
      if (isStateBallOnTable(this.state)) {
        const { side } = applyStateBounce(this.state);
        this.broadcast("fx", { type: "bounce", x: this.state.ballX, z: this.state.ballZ }, { afterNextPatch: true });
        const result = resolveBouncePoint({
          side,
          lastHitter: this.lastHitter,
          exchange: this.state.exchange,
          serveBounceCount: this.serveBounceCount,
          bouncedReceiver: this.bouncedReceiver,
        });
        this.serveBounceCount = result.serveBounceCount ?? this.serveBounceCount;
        this.bouncedReceiver = result.bouncedReceiver ?? this.bouncedReceiver;
        if (result.winner) this.point(result.winner as Side, result.reason);
      } else {
        const result = resolveOutPoint({
          lastHitter: this.lastHitter,
          exchange: this.state.exchange,
          serveBounceCount: this.serveBounceCount,
          bouncedReceiver: this.bouncedReceiver,
        });
        if (result?.winner) this.point(result.winner as Side, result.reason);
      }
    }

    if (Math.abs(this.state.ballZ) > 8 || Math.abs(this.state.ballX) > 6 || this.state.ballY < -1.6) {
      const result = resolveOutPoint({
        lastHitter: this.lastHitter,
        exchange: this.state.exchange,
        serveBounceCount: this.serveBounceCount,
        bouncedReceiver: this.bouncedReceiver,
      });
      if (result?.winner) this.point(result.winner as Side, result.reason);
    }
  }
}
