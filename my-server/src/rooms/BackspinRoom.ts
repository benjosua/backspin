import { Room, Client, ServerError, ErrorCode } from "colyseus";
import { BackspinState } from "./schema/BackspinState.js";
import { NET, TABLE as CORE_TABLE, PHYSICS as CORE_PHYSICS, resolvePlayerShot, solveReachableShot, stepPaddleX } from "../shared/backspin-core.js";
import { authUserFromToken, type AuthUser } from "../auth/config.js";
import { rankedStore } from "../ranked/store.js";

const TABLE = CORE_TABLE;
const PHYSICS = { ...CORE_PHYSICS, serveHeight: 0.95 };
const PADDLE_Z = { p1: 4.8, p2: -4.8 } as const;
const PADDLE_Y = 0.62;
const REACH = 0.95;
const TICK = NET.tickMs;
const PATCH_RATE = NET.patchMs;
const FIXED_DT = NET.tickMs / 1000;
const ROOM_CODE_CHANNEL = "$backspin_private_codes";

type Side = "p1" | "p2";
type Input = { targetX: number; targetY: number; aimX: number; aimDepth: number; vx: number; vy: number; speed: number; charging: boolean; chargeStartedAt: number; lastInputAt: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const other = (side: Side): Side => side === "p1" ? "p2" : "p1";
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
  private rankedMatchRecorded = false;
  private lastHitter: Side | null = null;
  private bouncedReceiver = false;
  private pointTimer = 0;
  private firstServer: Side = Math.random() < 0.5 ? "p1" : "p2";
  private accumulator = 0;

  static async onAuth(_token: string, options: any, context: any) {
    if (!options?.ranked) return true;
    const user = await authUserFromToken(context?.token);
    if (!user) throw new ServerError(ErrorCode.AUTH_FAILED, "ranked_requires_sign_in");
    return user;
  }

  async onCreate(options: any) {
    this.setState(new BackspinState());
    this.state.ranked = options?.ranked === true;
    this.state.mode = this.state.ranked ? "ranked" : options?.mode === "private" ? "private" : "public";
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
    this.inputs.set(client.sessionId, { targetX: 0, targetY: 0, aimX: 0, aimDepth: 0.5, vx: 0, vy: 0, speed: 1, charging: false, chargeStartedAt: 0, lastInputAt: 0 });
    if (this.state.ranked) {
      const user = auth && auth !== true ? auth : null;
      if (!user?.id) throw new ServerError(ErrorCode.AUTH_FAILED, "ranked_requires_sign_in");
      this.rankedUsers.set(side, user.id);
      options = { ...(options || {}), name: user.name };
    }
    this.handleProfile(client, options || {});
    this.state.joined = this.clients.length;
    if (this.clients.length === 2) {
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
    this.state.joined = this.clients.length;
  }

  onLeave(client: Client) {
    const leaver = this.sideOf(client);
    this.inputs.delete(client.sessionId);
    if (leaver === "p1") this.state.p1 = "";
    else if (leaver === "p2") this.state.p2 = "";

    this.state.joined = this.clients.length;
    if (this.state.phase === "waiting") return;

    if (this.state.phase !== "over" && leaver && this.clients.length > 0) {
      this.state.winner = other(leaver);
      this.state.phase = "over";
      this.finishRankedMatch("forfeit");
    }
  }

  onDispose() {
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

  private currentServer(): Side {
    const total = this.state.scoreP1 + this.state.scoreP2;
    const bucket = this.state.scoreP1 >= 10 && this.state.scoreP2 >= 10 ? total : Math.floor(total / 2);
    return bucket % 2 === 0 ? this.firstServer : other(this.firstServer);
  }

  private resetServe() {
    this.state.exchange = 0;
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.state.ballVx = 0; this.state.ballVy = 0; this.state.ballVz = 0;
    this.state.spinTop = 0; this.state.spinSide = 0;
    this.state.p1Charge = 0; this.state.p2Charge = 0;
    this.state.server = this.currentServer();
    this.state.phase = this.clients.length < 2 ? "waiting" : "serve";
    const z = this.state.server === "p1" ? PADDLE_Z.p1 - 0.45 : PADDLE_Z.p2 + 0.45;
    const x = this.state.server === "p1" ? this.state.p1X : this.state.p2X;
    this.state.ballX = x; this.state.ballY = PADDLE_Y + 0.34; this.state.ballZ = z;
  }

  private handleServe(client: Client) {
    const side = this.sideOf(client);
    if (!side || this.state.phase !== "serve" || this.state.server !== side || this.clients.length < 2) return;
    const zDir = side === "p1" ? -1 : 1;
    const x = side === "p1" ? this.state.p1X : this.state.p2X;
    const charge = side === "p1" ? this.state.p1Charge : this.state.p2Charge;
    const input = this.inputs.get(client.sessionId);
    this.state.ballX = x;
    this.state.ballY = PADDLE_Y + 0.34;
    this.state.ballZ = side === "p1" ? PADDLE_Z.p1 - 0.45 : PADDLE_Z.p2 + 0.45;
    const top = clamp(((input?.vy || 0) * 0.18) + charge * 0.25, -0.8, 0.8);
    const sideSpin = clamp((input?.vx || 0) * 0.12, -0.8, 0.8);
    const aimX = input?.aimX || 0;
    const aimDepth = input?.aimDepth ?? 0.5;
    const targetX = clamp(aimX * TABLE.halfWidth * 0.96 + sideSpin * TABLE.halfWidth * 0.22, -TABLE.halfWidth * 0.98, TABLE.halfWidth * 0.98);
    const targetZ = zDir * (0.08 + aimDepth * 0.88) * TABLE.halfLength;
    const shot = solveReachableShot({ x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ }, targetX, targetZ, 0.72 - charge * 0.16, top, sideSpin, side);
    const v = shot.velocity;
    this.state.ballVx = v.x; this.state.ballVy = v.y; this.state.ballVz = v.z;
    this.state.spinTop = shot.topSpin; this.state.spinSide = shot.sideSpin;
    this.lastHitter = side;
    this.bouncedReceiver = false;
    this.state.phase = "exchange";
    this.broadcast("fx", { type: "hit", side }, { afterNextPatch: true });
  }

  private hit(side: Side) {
    const paddleX = side === "p1" ? this.state.p1X : this.state.p2X;
    const input = this.inputs.get(side === "p1" ? this.state.p1 : this.state.p2);
    const charge = side === "p1" ? this.state.p1Charge : this.state.p2Charge;
    const offset = clamp((this.state.ballX - paddleX) / REACH, -1, 1);
    this.state.exchange += 1;
    const shot = resolvePlayerShot(
      {
        side,
        ball: { x: this.state.ballX, y: this.state.ballY, z: this.state.ballZ },
        incomingVelocity: { x: this.state.ballVx, y: this.state.ballVy, z: this.state.ballVz },
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
    this.lastHitter = side;
    this.bouncedReceiver = false;
    if (side === "p1") this.state.p1Charge = 0; else this.state.p2Charge = 0;
    this.broadcast("fx", { type: "hit", side, smash: shot.smash, intent: shot.intent }, { afterNextPatch: true });
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
    this.broadcast("fx", { type: "point", winner, reason }, { afterNextPatch: true });
    if (Math.max(this.state.scoreP1, this.state.scoreP2) >= 11 && Math.abs(this.state.scoreP1 - this.state.scoreP2) >= 2) {
      this.state.phase = "over";
      this.state.winner = winner;
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
      roomId: this.roomId,
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

  private stepSimulation(dtRaw: number) {
    this.accumulator += clamp(dtRaw, 0, 0.25);
    while (this.accumulator >= FIXED_DT) {
      this.accumulator -= FIXED_DT;
      this.update(FIXED_DT);
    }
  }

  private update(dt: number) {
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
    this.state.ballVx += this.state.spinSide * PHYSICS.magnus * dt;
    this.state.ballVy -= (30 + this.state.spinTop * 11) * dt;
    this.state.ballX += this.state.ballVx * dt;
    this.state.ballY += this.state.ballVy * dt;
    this.state.ballZ += this.state.ballVz * dt;

    if (Math.sign(prevZ) !== Math.sign(this.state.ballZ)) {
      const t = (0 - prevZ) / (this.state.ballZ - prevZ || 0.000001);
      const netY = prevY + (this.state.ballY - prevY) * t;
      if (netY - TABLE.ballRadius * 0.4 <= TABLE.netHeight && this.lastHitter) {
        this.state.ballZ = Math.sign(prevZ) * 0.06;
        this.state.ballVz *= -0.12;
        this.point(other(this.lastHitter), "NET");
        return;
      }
    }

    for (const side of ["p1", "p2"] as Side[]) {
      if (this.lastHitter === side || !this.bouncedReceiver) continue;
      const racketZ = side === "p1" ? PADDLE_Z.p1 : PADDLE_Z.p2;
      if (!(side === "p1" ? this.state.ballVz > 0 : this.state.ballVz < 0)) continue;
      if ((prevZ - racketZ) * (this.state.ballZ - racketZ) > 0) continue;
      const t = (racketZ - prevZ) / (this.state.ballZ - prevZ || 0.000001);
      const x = prevX + (this.state.ballX - prevX) * t;
      const y = prevY + (this.state.ballY - prevY) * t;
      const px = side === "p1" ? this.state.p1X : this.state.p2X;
      if (Math.abs(x - px) <= REACH && y >= 0.05 && y <= 3.4) {
        this.state.ballX = x; this.state.ballY = y; this.state.ballZ = racketZ;
        this.hit(side);
        return;
      }
    }

    if (this.state.ballVy < 0 && this.state.ballY <= TABLE.ballRadius) {
      if (Math.abs(this.state.ballX) <= TABLE.halfWidth && Math.abs(this.state.ballZ) <= TABLE.halfLength) {
        const side = this.state.ballZ > 0 ? "p1" : "p2";
        this.state.ballY = TABLE.ballRadius;
        this.state.ballVy = Math.abs(this.state.ballVy) * TABLE.bounceRestitution * (1 - Math.max(this.state.spinTop, 0) * 0.18);
        const zSign = Math.sign(this.state.ballVz) || 1;
        this.state.ballVz += zSign * this.state.spinTop * PHYSICS.speedScale;
        this.state.ballVx += this.state.spinSide * PHYSICS.curveScale;
        this.state.spinTop *= 0.55;
        this.state.spinSide *= 0.55;
        this.broadcast("fx", { type: "bounce", x: this.state.ballX, z: this.state.ballZ }, { afterNextPatch: true });
        if (this.lastHitter && side === this.lastHitter) this.point(other(this.lastHitter), "FAULT");
        else if (this.bouncedReceiver && this.lastHitter) this.point(this.lastHitter, "WINNER");
        else this.bouncedReceiver = true;
      } else if (this.lastHitter) {
        this.point(this.bouncedReceiver ? this.lastHitter : other(this.lastHitter), this.bouncedReceiver ? "WINNER" : "OUT");
      }
    }

    if ((Math.abs(this.state.ballZ) > 8 || Math.abs(this.state.ballX) > 6 || this.state.ballY < -1.6) && this.lastHitter) {
      this.point(this.bouncedReceiver ? this.lastHitter : other(this.lastHitter), this.bouncedReceiver ? "WINNER" : "OUT");
    }
  }
}
