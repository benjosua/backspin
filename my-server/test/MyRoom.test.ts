import assert from "assert";
import { Client } from "@colyseus/sdk";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { rankedStore } from "../src/ranked/store.js";
import { matchStore } from "../src/matches/store.js";
import { MatchReplayRecorder } from "../src/matches/MatchReplayRecorder.js";
import {
  CONTACT,
  NET,
  maxReachableContactX,
  resolvePlayerShot,
  simulateLegalServe,
  simulateReceiverContact,
  solveLegalServe,
  solveReachableShot,
  solveShot,
  stepPaddleX,
} from "../src/shared/backspin-core.js";
import { BOT_MAX_OFF_TABLE_X, getBot, resolveBotPaddleTarget, stepBotPaddle } from "../src/shared/backspin-bot.js";

function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tick = async () => {
      if (await check()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function serverHttp(colyseus: ColyseusTestServer<typeof appConfig>) {
  return `http://127.0.0.1:${(colyseus.server as any).port}`;
}

function serverWs(colyseus: ColyseusTestServer<typeof appConfig>) {
  return `ws://127.0.0.1:${(colyseus.server as any).port}`;
}


function makeReplayState(overrides: Record<string, any> = {}) {
  return {
    ballX: 1.23456,
    ballY: 0.5,
    ballZ: -2,
    ballVx: 3,
    ballVy: -4,
    ballVz: 5,
    spinTop: 0.1,
    spinSide: -0.2,
    p1X: 0.25,
    p2X: -0.25,
    p1Charge: 0.4,
    p2Charge: 0.6,
    scoreP1: 1,
    scoreP2: 2,
    phase: "exchange",
    server: "p1",
    exchange: 3,
    ...overrides,
  } as any;
}

function replayShot(overrides: Record<string, any> = {}) {
  return {
    hitter: "p1",
    isServe: false,
    pointSeq: 1,
    exchange: 1,
    contact: {},
    outgoing: {},
    charge: 0,
    aimX: 0,
    aimDepth: 0.5,
    spinTop: 0,
    spinSide: 0,
    speed: 10,
    intent: "drive",
    smash: false,
    ...overrides,
  } as any;
}

function replayPoint(overrides: Record<string, any> = {}) {
  return {
    seq: 1,
    winner: "p1",
    reason: "WINNER",
    server: "p1",
    p1Score: 1,
    p2Score: 0,
    rallyLength: 1,
    terminalBall: {},
    ...overrides,
  } as any;
}

async function register(colyseus: ColyseusTestServer<typeof appConfig>, email: string, name: string) {
  const response = await fetch(`${serverHttp(colyseus)}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "secret1", options: { name } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "register failed");
  return data as { user: { id: string; email: string; name: string }; token: string };
}

describe("backspin room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => {
    await colyseus.cleanup();
    await rankedStore.resetForTests?.();
    await matchStore.resetForTests?.();
  });

  it("lets a client connect to a public backspin room", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });

    await waitFor(() => client.state?.toJSON?.().joined === 1, "room state");
    const state = client.state.toJSON();

    assert.strictEqual(client.sessionId, room.clients[0].sessionId);
    assert.strictEqual(state.phase, "waiting");
    assert.strictEqual(state.mode, "public");
    assert.strictEqual(state.joined, 1);
    assert.match(state.roomCode, /^[A-HJ-NP-Z2-9]{5}$/);
  });

  it("starts a bot online test room with one real client", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "bot", botDifficulty: "master" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });
    client.onMessage("fx", () => {});

    await waitFor(() => client.state?.toJSON?.().joined === 2, "bot room joined");
    const state = client.state.toJSON();

    assert.strictEqual(room.maxClients, 1);
    assert.strictEqual(state.mode, "bot");
    assert.strictEqual(state.joined, 2);
    assert.strictEqual(state.p1, client.sessionId);
    assert.strictEqual(state.p2, "$bot");
    assert.strictEqual(state.p2Name, "AI MASTER");
    assert.notStrictEqual(state.phase, "waiting");
    await client.leave();
  });

  it("auto-serves for the AI in bot online test rooms", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "bot", botDifficulty: "pro" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });
    client.onMessage("fx", () => {});

    await waitFor(() => room.state.joined === 2, "bot room ready");
    room.state.phase = "serve";
    room.state.server = "p2";

    await waitFor(() => client.state.toJSON().phase === "exchange", "bot auto serve", 1500);
    assert.strictEqual(room.state.phase, "exchange");
    assert.strictEqual(room.state.p2Charge, 0);
    await client.leave();
  });

  it("moves the AI paddle toward incoming balls in bot online test rooms", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "bot", botDifficulty: "master" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });
    client.onMessage("fx", () => {});

    await waitFor(() => room.state.joined === 2, "bot room ready");
    room.state.phase = "exchange";
    room.state.ballX = 2;
    room.state.ballY = 1;
    room.state.ballZ = 0;
    room.state.ballVx = 0;
    room.state.ballVy = 0;
    room.state.ballVz = -4;

    await waitFor(() => room.state.p2X > 0.1, "bot paddle movement", 1000);
    assert.ok(room.state.p2X > 0.1);
    await client.leave();
  });

  it("lets the AI return reachable shots in bot online test rooms", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "bot", botDifficulty: "pro" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });
    client.onMessage("fx", () => {});

    await waitFor(() => room.state.joined === 2, "bot room ready");
    room.state.phase = "exchange";
    room.lastHitter = "p1";
    room.bouncedReceiver = true;
    room.state.exchange = 1;
    room.state.p2X = 0;
    room.state.ballX = 0;
    room.state.ballY = 1;
    room.state.ballZ = -4.7;
    room.state.ballVx = 0;
    room.state.ballVy = 0;
    room.state.ballVz = -3;
    room.update(0.05);

    assert.strictEqual(room.lastHitter, "p2");
    assert.ok(room.state.exchange >= 2);
    assert.ok(room.state.ballVz > 0);
    await client.leave();
  });

  it("starts a bot rematch after one human rematch request", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "bot", botDifficulty: "rookie" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });
    const rematches: any[] = [];
    client.onMessage("fx", () => {});
    client.onMessage("rematch", (message) => rematches.push(message));

    await waitFor(() => room.state.joined === 2, "bot room ready");
    room.state.phase = "exchange";
    room.state.scoreP1 = 10;
    room.point("p1", "WINNER");
    await waitFor(() => client.state.toJSON().phase === "over", "bot match over");

    client.send("rematch");
    await waitFor(() => client.state.toJSON().phase === "serve", "bot rematch started");
    assert.ok(rematches.some((message) => message.started === true));
    assert.strictEqual(client.state.toJSON().scoreP1, 0);
    assert.strictEqual(client.state.toJSON().scoreP2, 0);
    await client.leave();
  });

  it("keeps simulating the ball briefly after an online point", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "bot", botDifficulty: "rookie" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });
    client.onMessage("fx", () => {});

    await waitFor(() => room.state.joined === 2, "bot room ready");
    room.state.phase = "exchange";
    room.lastHitter = "p1";
    room.bouncedReceiver = true;
    room.state.ballX = 0;
    room.state.ballY = 1;
    room.state.ballZ = 1;
    room.state.ballVx = 0.3;
    room.state.ballVy = -1;
    room.state.ballVz = 4;
    room.state.p1Charge = 0.7;
    room.state.p2Charge = 0.6;

    room.point("p1", "WINNER");
    const zAtPoint = room.state.ballZ;
    room.update(1 / 60);

    assert.strictEqual(room.state.phase, "point");
    assert.strictEqual(room.state.p1Charge, 0);
    assert.strictEqual(room.state.p2Charge, 0);
    assert.ok(room.state.ballZ > zAtPoint, "ball should keep moving during point phase");

    for (let i = 0; i < 60; i += 1) room.update(1 / 60);
    assert.strictEqual(room.state.phase, "serve");
    await client.leave();
  });

  it("uses one shared 60hz paddle step for prediction and authority", () => {
    const step = stepPaddleX(0, 3, NET.tickMs / 1000, 1);

    assert.strictEqual(NET.patchMs, 1000 / 60);
    assert.strictEqual(NET.inputSendMs, 1000 / 60);
    assert.strictEqual(Number(step.x.toFixed(6)), Number((NET.paddleSpeed / 60).toFixed(6)));
    assert.strictEqual(step.vx, NET.paddleSpeed);
  });

  it("adjusts a legal side-spun shot that would curve beyond max racket reach", () => {
    const ball = { x: -3.35, y: 0.45, z: CONTACT.racketZ };
    const targetX = 2.5;
    const targetZ = -2.1;
    const flightTime = 0.5;
    const topSpin = 0.29;
    const sideSpin = 0.28;

    const rawVelocity = solveShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin);
    const rawContact = simulateReceiverContact(ball, rawVelocity, topSpin, sideSpin, "p1");
    assert.ok(rawContact.contact, "raw shot should cross receiver racket plane");
    assert.ok(rawContact.catchableHeight, "raw shot should be at catchable height");
    assert.ok(Math.abs(rawContact.contact.x) > maxReachableContactX(), `expected raw contact outside reach, got ${rawContact.contact.x}`);

    const fixed = solveReachableShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin, "p1");
    const fixedContact = simulateReceiverContact(ball, fixed.velocity, fixed.topSpin, fixed.sideSpin, "p1");
    assert.strictEqual(fixedContact.ok, true);
    assert.ok(Math.abs(fixedContact.contact.x) <= maxReachableContactX(), `expected fixed contact within reach, got ${fixedContact.contact.x}`);
    assert.strictEqual(fixed.reachAdjusted, true);
  });

  it("keeps already reachable player shots unchanged", () => {
    const shot = resolvePlayerShot(
      {
        side: "p1",
        ball: { x: 0, y: 0.9, z: CONTACT.racketZ },
        incomingVelocity: { x: 0, y: 0, z: 8 },
        offset: 0,
        exchange: 1,
      },
      { charge: 0, chargeHeldMs: 0, charging: false, swipeX: 0, swipeY: 0, aimX: 0, aimDepth: 0.5 },
      { random: () => 0.5 },
    );

    assert.strictEqual(shot.reachAdjusted, false);
    assert.strictEqual(shot.target.x, 0);
    assert.strictEqual(shot.spin.side, 0);
  });

  it("keeps bot paddle movement inside the bot off-table lane", () => {
    const target = resolveBotPaddleTarget({
      side: "p2",
      ball: { x: 8, y: 1, z: 0 },
      velocity: { x: 12, y: 0, z: -4 },
      spin: { top: 0, side: 1 },
      phase: "exchange",
      lastHitter: "p1",
      exchange: 1,
      bot: getBot("master"),
      currentX: 0,
    });
    const racket = { x: BOT_MAX_OFF_TABLE_X + 1, vx: 20 };

    stepBotPaddle({ racket, target: BOT_MAX_OFF_TABLE_X + 2, dt: 1 / 60, bot: getBot("master"), exchange: 1 });

    assert.ok(Math.abs(target) <= BOT_MAX_OFF_TABLE_X, `bot target too wide: ${target}`);
    assert.ok(Math.abs(racket.x) <= BOT_MAX_OFF_TABLE_X, `bot paddle too wide: ${racket.x}`);
  });

  it("keeps representative player shots within receiver max reach when catchable", () => {
    const sides = ["p1", "p2"] as const;
    const xs = [-3.35, 0, 3.35];
    const ys = [0.45, 0.9, 1.6];
    const aimXs = [-1, -0.5, 0, 0.5, 1];
    const aimDepths = [0, 0.5, 1];
    const charges = [0, 0.5, 1];
    const swipeXs = [-3, 0, 3];
    const swipeYs = [-3, 0, 3];

    for (const side of sides) {
      const z = side === "p1" ? CONTACT.racketZ : -CONTACT.racketZ;
      const incomingZ = side === "p1" ? 8 : -8;
      for (const x of xs) for (const y of ys) for (const aimX of aimXs) for (const aimDepth of aimDepths) {
        for (const charge of charges) for (const swipeX of swipeXs) for (const swipeY of swipeYs) {
          const shot = resolvePlayerShot(
            {
              side,
              ball: { x, y, z },
              incomingVelocity: { x: 0, y: 0, z: incomingZ },
              offset: 0,
              exchange: 1,
            },
            { charge, chargeHeldMs: charge * 500, charging: charge > 0, swipeX, swipeY, aimX, aimDepth },
            { random: () => 0.5, swipeSideScale: 0.34 },
          );
          const contact = simulateReceiverContact({ x, y, z }, shot.velocity, shot.spin.top, shot.spin.side, side);
          if (contact.catchableHeight) {
            assert.ok(contact.reachableX, `unreachable ${side} shot contact=${contact.contact?.x} aim=${aimX} depth=${aimDepth} charge=${charge} swipe=(${swipeX},${swipeY})`);
          }
        }
      }
    }
  });

  it("moves p2 in negative server coordinates when it receives flipped local-right input", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => p1.state?.toJSON?.().joined === 2 && p2.state?.toJSON?.().joined === 2, "both players joined");
    p2.send("input", { x: -2, y: 0, aimX: 0, aimDepth: 0.5, vx: -6, vy: 0, speed: 1 });

    await waitFor(() => p2.state.toJSON().p2X < 0, "p2 negative movement");
    assert.ok(p2.state.toJSON().p2X < 0);
  });

  it("keeps p2 local-right sidespin positive after client coordinate flip", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => p2.state?.toJSON?.().joined === 2, "both players joined");
    room.state.phase = "serve";
    room.state.server = "p2";
    p2.send("input", { x: 0, y: 0, aimX: 0, aimDepth: 0.5, vx: -6, vy: 0, speed: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    p2.send("serve");

    await waitFor(() => p2.state.toJSON().phase === "exchange", "p2 serve");
    const state = p2.state.toJSON();

    assert.ok(state.spinSide < 0, `expected server spin to be negative after p2 local-right flip, got ${state.spinSide}`);
    assert.ok(-state.spinSide > 0, "p2 local view flips server spin back to positive/right");
  });

  it("broadcasts valid online emotes with the sender side", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    const p1Emotes: any[] = [];
    const p2Emotes: any[] = [];
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});
    p1.onMessage("emote", (message) => p1Emotes.push(message));
    p2.onMessage("emote", (message) => p2Emotes.push(message));

    await waitFor(() => p1.state?.toJSON?.().joined === 2 && p2.state?.toJSON?.().joined === 2, "both players joined");
    p1.send("emote", { emoteId: "1" });

    await waitFor(() => p1Emotes.length === 1 && p2Emotes.length === 1, "emote broadcast");
    assert.deepStrictEqual(p1Emotes[0], { side: "p1", emoteId: "1", emoji: "👍" });
    assert.deepStrictEqual(p2Emotes[0], { side: "p1", emoteId: "1", emoji: "👍" });
    await p1.leave();
    await p2.leave();
  });

  it("ignores invalid online emotes", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    const p1Emotes: any[] = [];
    const p2Emotes: any[] = [];
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});
    p1.onMessage("emote", (message) => p1Emotes.push(message));
    p2.onMessage("emote", (message) => p2Emotes.push(message));

    await waitFor(() => p1.state?.toJSON?.().joined === 2 && p2.state?.toJSON?.().joined === 2, "both players joined");
    p1.send("emote", { emoteId: "9" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(p1Emotes.length, 0);
    assert.strictEqual(p2Emotes.length, 0);
    await p1.leave();
    await p2.leave();
  });

  it("rate-limits spammed online emotes", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    const p2Emotes: any[] = [];
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});
    p1.onMessage("emote", () => {});
    p2.onMessage("emote", (message) => p2Emotes.push(message));

    await waitFor(() => p1.state?.toJSON?.().joined === 2 && p2.state?.toJSON?.().joined === 2, "both players joined");
    p1.send("emote", { emoteId: "1" });
    await waitFor(() => p2Emotes.length === 1, "first emote broadcast");
    p1.send("emote", { emoteId: "2" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.strictEqual(p2Emotes.length, 1);
    assert.deepStrictEqual(p2Emotes[0], { side: "p1", emoteId: "1", emoji: "👍" });
    await p1.leave();
    await p2.leave();
  });

  it("starts a rematch against the same online player when both request revenge", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    const p1Rematches: any[] = [];
    const p2Rematches: any[] = [];
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});
    p1.onMessage("rematch", (message) => p1Rematches.push(message));
    p2.onMessage("rematch", (message) => p2Rematches.push(message));

    await waitFor(() => room.clients.length === 2, "players joined");
    room.state.phase = "exchange";
    room.state.scoreP1 = 10;
    room.state.scoreP2 = 7;
    room.point("p1", "WINNER");
    await waitFor(() => p1.state.toJSON().phase === "over" && p2.state.toJSON().phase === "over", "match over");

    p1.send("rematch");
    await waitFor(() => p1Rematches.some((message) => message.count === 1), "first rematch request");
    assert.strictEqual(p1.state.toJSON().phase, "over");

    p2.send("rematch");
    await waitFor(() => p1.state.toJSON().phase === "serve" && p2.state.toJSON().phase === "serve", "rematch started");
    assert.ok(p1Rematches.some((message) => message.started === true));
    assert.ok(p2Rematches.some((message) => message.started === true));
    assert.strictEqual(p1.state.toJSON().scoreP1, 0);
    assert.strictEqual(p1.state.toJSON().scoreP2, 0);
    assert.strictEqual(p1.state.toJSON().winner, "");
    await p1.leave();
    await p2.leave();
  });

  it("clamps extreme serves into legal two-bounce reachable serves", () => {
    const sides = ["p1", "p2"] as const;
    const aimXs = [-1, 0, 1];
    const aimDepths = [0, 1];

    for (const side of sides) {
      const zDir = side === "p1" ? -1 : 1;
      const ball = { x: side === "p1" ? -0.9 : 0.9, y: 0.96, z: side === "p1" ? 4.35 : -4.35 };
      for (const aimX of aimXs) for (const aimDepth of aimDepths) {
        const targetX = aimX * 2.85 * 0.96;
        const targetZ = zDir * (0.08 + aimDepth * 0.88) * 4.75;
        const serve = solveLegalServe(ball, targetX, targetZ, 0.46, 0.8, aimX * 0.8, side);
        const contact = simulateLegalServe(ball, serve.velocity, serve.topSpin, serve.sideSpin, side);

        assert.strictEqual(contact.ok, true, `${side} aim=${aimX} depth=${aimDepth} reason=${contact.reason}`);
        assert.ok(contact.bounces[0].z * zDir < 0, "first serve bounce must be on server side");
        assert.ok(contact.bounces[1].z * zDir > 0, "second serve bounce must be on receiver side");
        assert.ok(Math.abs(contact.contact!.x) <= maxReachableContactX(), `serve contact outside reach: ${contact.contact!.x}`);
      }
    }
  });

  it("keeps p2 legal serve sidespin direction after client coordinate flip", () => {
    const ball = { x: 0, y: 0.96, z: -4.35 };
    const serve = solveLegalServe(ball, 0, 2.2, 0.56, 0.15, -0.72, "p2");

    assert.ok(serve.sideSpin < 0, `expected server spin to stay negative, got ${serve.sideSpin}`);
    assert.strictEqual(simulateLegalServe(ball, serve.velocity, serve.topSpin, serve.sideSpin, "p2").ok, true);
  });

  it("does not fault a legal serve on the first server-side bounce", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2, "players joined");
    room.state.phase = "exchange";
    room.lastHitter = "p1";
    room.bouncedReceiver = false;
    room.serveBounceCount = 0;
    room.state.ballX = 0;
    room.state.ballY = 0.13;
    room.state.ballZ = 1.2;
    room.state.ballVx = 0;
    room.state.ballVy = -1;
    room.state.ballVz = -2;
    room.update(1 / 60);

    assert.strictEqual(room.state.phase, "exchange");
    assert.strictEqual(room.state.pointReason, "");
    assert.strictEqual(room.serveBounceCount, 1);
    await p1.leave();
    await p2.leave();
  });

  it("faults a serve that lands first on the receiver side", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "P1" });
    const p2 = await colyseus.connectTo(room, { name: "P2" });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2, "players joined");
    room.state.phase = "exchange";
    room.lastHitter = "p1";
    room.bouncedReceiver = false;
    room.serveBounceCount = 0;
    room.state.ballX = 0;
    room.state.ballY = 0.13;
    room.state.ballZ = -1.2;
    room.state.ballVx = 0;
    room.state.ballVy = -1;
    room.state.ballVz = -2;
    room.update(1 / 60);

    assert.strictEqual(room.state.phase, "point");
    assert.strictEqual(room.state.pointWinner, "p2");
    assert.strictEqual(room.state.pointReason, "FAULT");
    await p1.leave();
    await p2.leave();
  });

  it("registers account users and exposes initial rank", async () => {
    const account = await register(colyseus, "ranked@example.com", "RALLY");
    const response = await fetch(`${serverHttp(colyseus)}/api/me/rank`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(account.user.name, "RALLY");
    assert.strictEqual(data.profile.rating, 1200);
    assert.strictEqual(data.profile.wins, 0);
    assert.strictEqual(data.profile.losses, 0);
  });

  it("updates account name used by ranked profile and leaderboard", async () => {
    const account = await register(colyseus, "rename@example.com", "OLDNAME");
    const response = await fetch(`${serverHttp(colyseus)}/api/me/name`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name!" }),
    });
    const data = await response.json();
    const leaderboardResponse = await fetch(`${serverHttp(colyseus)}/api/leaderboard`);
    const leaderboardData = await leaderboardResponse.json();
    const entry = leaderboardData.leaderboard.find((row: any) => row.name === "NEWNAME");

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.user.name, "NEWNAME");
    assert.strictEqual(data.profile.name, "NEWNAME");
    assert.strictEqual(entry.name, "NEWNAME");
  });

  it("does not expose emails or user ids in the public leaderboard", async () => {
    const account = await register(colyseus, "privacy@example.com", "PRIVATE");
    const response = await fetch(`${serverHttp(colyseus)}/api/leaderboard`);
    const data = await response.json();
    const entry = data.leaderboard.find((row: any) => row.name === "PRIVATE");

    assert.strictEqual(response.status, 200);
    assert.ok(entry);
    assert.strictEqual(entry.email, undefined);
    assert.strictEqual(entry.userId, undefined);
    assert.strictEqual(JSON.stringify(data).includes("privacy@example.com"), false);
    assert.strictEqual(JSON.stringify(data).includes(account.user.id), false);
  });

  it("rejects ranked queue clients without auth", async () => {
    await assert.rejects(
      () => colyseus.sdk.joinOrCreate("ranked_queue", { rank: 9999 }),
      /ranked_requires_sign_in|auth/i,
    );
  });

  it("ignores client supplied rank in ranked queue", async () => {
    const account = await register(colyseus, "fake-rank@example.com", "FAKE");
    colyseus.sdk.auth.token = account.token;

    const queue = await colyseus.sdk.joinOrCreate("ranked_queue", { rank: 9999 });
    const room = colyseus.getRoomById<any>(queue.roomId);

    await waitFor(() => room.clients[0]?.userData?.rank === 1200, "server-loaded queue rank");
    assert.strictEqual(room.clients[0].userData.rank, 1200);
    await queue.leave();
  });

  it("hands ranked queue players into a ranked backspin match", async () => {
    const p1Account = await register(colyseus, "queue-p1@example.com", "QPONE");
    const p2Account = await register(colyseus, "queue-p2@example.com", "QPTWO");
    const sdk1 = new Client(serverWs(colyseus));
    const sdk2 = new Client(serverWs(colyseus));
    sdk1.auth.token = p1Account.token;
    sdk2.auth.token = p2Account.token;
    let match1: any = null;
    let match2: any = null;

    const q1 = await sdk1.joinOrCreate("ranked_queue", { rank: 9999 });
    q1.onMessage("clients", () => {});
    q1.onMessage("seat", async (reservation) => {
      q1.send("confirm");
      match1 = await sdk1.consumeSeatReservation(reservation);
    });
    const q2 = await sdk2.joinOrCreate("ranked_queue", { rank: 1 });
    q2.onMessage("clients", () => {});
    q2.onMessage("seat", async (reservation) => {
      q2.send("confirm");
      match2 = await sdk2.consumeSeatReservation(reservation);
    });

    await waitFor(() => Boolean(match1 && match2), "ranked seat reservation", 3000);
    const matchRoom = colyseus.getRoomById<any>(match1.roomId);
    assert.strictEqual(matchRoom.state.ranked, true);
    assert.strictEqual(matchRoom.state.mode, "ranked");
    await match1.leave();
    await match2.leave();
  });

  it("records Elo once for completed ranked matches", async () => {
    const p1Account = await register(colyseus, "p1@example.com", "PONE");
    const p2Account = await register(colyseus, "p2@example.com", "PTWO");
    const room = await colyseus.createRoom<any>("backspin", { ranked: true, mode: "ranked" });
    const sdk1 = new Client(serverWs(colyseus));
    const sdk2 = new Client(serverWs(colyseus));
    sdk1.auth.token = p1Account.token;
    sdk2.auth.token = p2Account.token;
    const p1 = await sdk1.joinById(room.roomId, { ranked: true });
    const p2 = await sdk2.joinById(room.roomId, { ranked: true });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2, "ranked players joined");
    room.state.phase = "exchange";
    room.state.scoreP1 = 10;
    room.state.scoreP2 = 0;
    room.point("p1", "WINNER");
    room.point("p1", "WINNER");

    await waitFor(async () => (await rankedStore.getProfile(p1Account.user.id)).gamesPlayed === 1, "ranked match persisted");
    const p1Profile = await rankedStore.getProfile(p1Account.user.id);
    const p2Profile = await rankedStore.getProfile(p2Account.user.id);

    assert.strictEqual(p1Profile.rating, 1224);
    assert.strictEqual(p2Profile.rating, 1176);
    assert.strictEqual(p1Profile.wins, 1);
    assert.strictEqual(p2Profile.losses, 1);
    assert.strictEqual(p1Profile.gamesPlayed, 1);
    await p1.leave();
    await p2.leave();
  });

  it("keeps queued replay writes bound to their original match across rematches", async () => {
    let releaseFirstCreate!: () => void;
    let createCalls = 0;
    const gate = new Promise<void>((resolve) => { releaseFirstCreate = resolve; });
    const created: any[] = [];
    const shots: any[] = [];
    const points: any[] = [];
    const chunks: any[] = [];
    const finishes: any[] = [];
    const store: any = {
      async init() {},
      async createMatch(input: any) {
        createCalls += 1;
        if (createCalls === 1) await gate;
        created.push(input);
        return { ...input, endedAt: null, endedReason: null, winner: null, p1Score: 0, p2Score: 0, durationMs: 0, totalPoints: 0, totalShots: 0 };
      },
      async finishMatch(input: any) { finishes.push(input); },
      async addPoint(input: any) { points.push(input); },
      async addShot(input: any) { shots.push(input); },
      async addReplayChunk(input: any) { chunks.push(input); },
      async getMatchDetails() { return null; },
      async getReplay() { return null; },
      async getShotReplay() { return null; },
      async listMatchesForUser() { return []; },
      async getUserStats() { throw new Error("unused"); },
    };
    const recorder = new MatchReplayRecorder(store);
    const firstMatchId = recorder.start({ roomId: "race", matchSeq: 1, mode: "ranked", ranked: true, p1Name: "P1", p2Name: "P2" });
    recorder.recordShot(replayShot(), 100);
    recorder.recordPoint(replayPoint(), 120);
    recorder.recordFrame(makeReplayState(), 140);
    recorder.finalize({ endedReason: "completed", winner: "p1", p1Score: 11, p2Score: 9 }, 200);
    const secondMatchId = recorder.start({ roomId: "race", matchSeq: 2, mode: "ranked", ranked: true, p1Name: "P1", p2Name: "P2" });
    recorder.recordShot(replayShot({ pointSeq: 2 }), 10);

    releaseFirstCreate();
    await recorder.whenIdle();

    assert.notStrictEqual(secondMatchId, firstMatchId);
    assert.deepStrictEqual(created.map((match) => match.id), [firstMatchId, secondMatchId]);
    assert.strictEqual(shots[0].matchId, firstMatchId);
    assert.strictEqual(shots[0].seq, 1);
    assert.strictEqual(shots[0].timeMs, 100);
    assert.strictEqual(points[0].matchId, firstMatchId);
    assert.strictEqual(points[0].timeMs, 120);
    assert.strictEqual(chunks[0].matchId, firstMatchId);
    assert.strictEqual(chunks[0].startMs, 140);
    assert.strictEqual(chunks[0].frames[0][1], 1.2346);
    assert.strictEqual(finishes[0].matchId, firstMatchId);
    assert.strictEqual(finishes[0].durationMs, 200);
    assert.strictEqual(finishes[0].totalPoints, 1);
    assert.strictEqual(finishes[0].totalShots, 1);
    assert.strictEqual(shots[1].matchId, secondMatchId);
    assert.strictEqual(shots[1].timeMs, 10);
  });

  it("filters shot replay frames across multiple replay chunks", async () => {
    const p1 = await register(colyseus, "chunk-p1@example.com", "CHUNK1");
    const p2 = await register(colyseus, "chunk-p2@example.com", "CHUNK2");
    const match = await matchStore.createMatch({
      roomId: "chunk-room",
      matchSeq: 1,
      mode: "ranked",
      ranked: true,
      p1UserId: p1.user.id,
      p2UserId: p2.user.id,
      p1Name: "CHUNK1",
      p2Name: "CHUNK2",
    });
    const shotId = `${match.id}:shot:1`;
    await matchStore.addShot({ id: shotId, matchId: match.id, seq: 1, timeMs: 1000, pointSeq: 1, exchange: 1, hitter: "p1", isServe: false, contact: {}, outgoing: {}, charge: 0, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 10, intent: "drive", smash: false });
    await matchStore.addShot({ id: `${match.id}:shot:2`, matchId: match.id, seq: 2, timeMs: 5000, pointSeq: 2, exchange: 1, hitter: "p2", isServe: false, contact: {}, outgoing: {}, charge: 0, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 10, intent: "drive", smash: false });
    await matchStore.addPoint({ id: `${match.id}:point:1`, matchId: match.id, seq: 1, timeMs: 1300, winner: "p1", reason: "WINNER", server: "p1", p1Score: 1, p2Score: 0, rallyLength: 1, terminalBall: {} });
    await matchStore.addReplayChunk({ matchId: match.id, chunkIndex: 0, startMs: 0, endMs: 100, frames: [[0], [100]] });
    await matchStore.addReplayChunk({ matchId: match.id, chunkIndex: 1, startMs: 900, endMs: 1300, frames: [[900], [1000], [1300]] });
    await matchStore.addReplayChunk({ matchId: match.id, chunkIndex: 2, startMs: 1400, endMs: 1600, frames: [[1400], [1600]] });
    await matchStore.finishMatch({ matchId: match.id, endedReason: "completed", winner: "p1", p1Score: 11, p2Score: 8, durationMs: 1600, totalPoints: 1, totalShots: 2 });

    const replay = await matchStore.getShotReplay(match.id, shotId);

    assert.deepStrictEqual(replay?.frames.map((frame) => frame[0]), [900, 1000, 1300]);
  });

  it("records authoritative replay data and exposes match replay APIs", async () => {
    const p1Account = await register(colyseus, "replay-p1@example.com", "REPLAY1");
    const p2Account = await register(colyseus, "replay-p2@example.com", "REPLAY2");
    const room = await colyseus.createRoom<any>("backspin", { ranked: true, mode: "ranked" });
    const sdk1 = new Client(serverWs(colyseus));
    const sdk2 = new Client(serverWs(colyseus));
    sdk1.auth.token = p1Account.token;
    sdk2.auth.token = p2Account.token;
    const p1 = await sdk1.joinById(room.roomId, { ranked: true });
    const p2 = await sdk2.joinById(room.roomId, { ranked: true });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2 && Boolean(room.replay.currentMatchId), "ranked replay started");
    const matchId = room.replay.currentMatchId;
    room.stepSimulation(1 / 60);
    room.state.phase = "serve";
    room.state.server = "p1";
    p1.send("input", { x: 0, y: 0, aimX: 0.2, aimDepth: 0.6, vx: 1, vy: 0.5, speed: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    p1.send("serve");
    await waitFor(() => room.state.phase === "exchange", "serve shot recorded");
    room.stepSimulation(1 / 60);
    room.state.scoreP1 = 10;
    room.point("p1", "WINNER");

    await waitFor(async () => {
      const replay = await matchStore.getReplay(matchId);
      return Boolean(replay?.match.endedAt && replay.shots.length >= 1 && replay.points.length === 1 && replay.chunks.length >= 1);
    }, "persisted replay", 3000);

    const replay = (await matchStore.getReplay(matchId))!;
    const rankedMatches = await rankedStore.recordedMatchesForTests?.();
    assert.strictEqual(replay.match.winner, "p1");
    assert.strictEqual(replay.match.p1Score, 11);
    assert.strictEqual(replay.stats.totalPoints, 1);
    assert.ok(replay.stats.totalShots >= 1);
    assert.strictEqual(replay.points[0].reason, "WINNER");
    assert.ok(replay.chunks[0].frames.length >= 1);
    assert.ok(replay.chunks[0].frames.every((frame, index, frames) => index === 0 || frame[0] >= frames[index - 1][0]));
    assert.ok(rankedMatches?.some((match) => match.matchId === matchId), "ranked match should link to replay match");

    const summaryResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}`, { headers: { Authorization: `Bearer ${p1Account.token}` } });
    const summary = await summaryResponse.json();
    assert.strictEqual(summaryResponse.status, 200);
    assert.strictEqual(summary.match.id, matchId);
    assert.strictEqual(summary.stats.totalPoints, 1);

    const myMatchesResponse = await fetch(`${serverHttp(colyseus)}/api/me/matches`, { headers: { Authorization: `Bearer ${p1Account.token}` } });
    const myMatches = await myMatchesResponse.json();
    assert.strictEqual(myMatchesResponse.status, 200);
    assert.strictEqual(myMatches.matches.length, 1);
    assert.strictEqual(myMatches.matches[0].match.id, matchId);
    assert.strictEqual(myMatches.matches[0].viewerSide, "p1");
    assert.strictEqual(myMatches.matches[0].replayReady, true);
    assert.strictEqual(myMatches.matches[0].stats.totalPoints, 1);

    const p2MatchesResponse = await fetch(`${serverHttp(colyseus)}/api/me/matches`, { headers: { Authorization: `Bearer ${p2Account.token}` } });
    const p2Matches = await p2MatchesResponse.json();
    assert.strictEqual(p2MatchesResponse.status, 200);
    assert.strictEqual(p2Matches.matches[0].viewerSide, "p2");

    const noAuthMatchesResponse = await fetch(`${serverHttp(colyseus)}/api/me/matches`);
    assert.strictEqual(noAuthMatchesResponse.status, 401);

    const noReplay = await matchStore.createMatch({
      roomId: "manual-no-replay",
      matchSeq: 1,
      mode: "ranked",
      ranked: true,
      p1UserId: p1Account.user.id,
      p2UserId: p2Account.user.id,
      p1Name: "REPLAY1",
      p2Name: "REPLAY2",
    });
    await matchStore.finishMatch({ matchId: noReplay.id, endedReason: "completed", winner: "p2", p1Score: 9, p2Score: 11, durationMs: 1000, totalPoints: 2, totalShots: 0 });
    const mixedMatchesResponse = await fetch(`${serverHttp(colyseus)}/api/me/matches`, { headers: { Authorization: `Bearer ${p1Account.token}` } });
    const mixedMatches = await mixedMatchesResponse.json();
    const noReplayRow = mixedMatches.matches.find((item: any) => item.match.id === noReplay.id);
    assert.ok(noReplayRow);
    assert.strictEqual(noReplayRow.replayReady, false);

    const replayResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}/replay`, { headers: { Authorization: `Bearer ${p1Account.token}` } });
    const replayBody = await replayResponse.json();
    assert.strictEqual(replayResponse.status, 200);
    assert.ok(replayBody.chunks[0].frames.length >= 1);

    const p2ReplayResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}/replay`, { headers: { Authorization: `Bearer ${p2Account.token}` } });
    const p2ReplayBody = await p2ReplayResponse.json();
    assert.strictEqual(p2ReplayResponse.status, 200);
    assert.deepStrictEqual(p2ReplayBody.chunks, replayBody.chunks);

    const shotId = replay.shots[0].id;
    const shotResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}/shots/${encodeURIComponent(shotId)}/replay`, { headers: { Authorization: `Bearer ${p1Account.token}` } });
    const shotBody = await shotResponse.json();
    assert.strictEqual(shotResponse.status, 200);
    assert.strictEqual(shotBody.shot.id, shotId);
    assert.ok(shotBody.frames.length >= 1);

    const unauthorizedResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}`);
    assert.strictEqual(unauthorizedResponse.status, 403);
    const unauthorizedReplayResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}/replay`);
    assert.strictEqual(unauthorizedReplayResponse.status, 403);
    const missingResponse = await fetch(`${serverHttp(colyseus)}/api/matches/not-a-match`, { headers: { Authorization: `Bearer ${p1Account.token}` } });
    assert.strictEqual(missingResponse.status, 404);

    await p1.leave();
    await p2.leave();
  });

  it("lets anyone with a non-ranked match id load the shared replay", async () => {
    const room = await colyseus.createRoom<any>("backspin", { mode: "private" });
    const p1 = await colyseus.connectTo(room, { name: "LINK1" });
    const p2 = await colyseus.connectTo(room, { name: "LINK2" });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2 && Boolean(room.replay.currentMatchId), "non-ranked replay started");
    const matchId = room.replay.currentMatchId;
    room.stepSimulation(1 / 60);
    room.state.scoreP1 = 10;
    room.point("p1", "WINNER");

    await waitFor(async () => {
      const replay = await matchStore.getReplay(matchId);
      return Boolean(replay?.match.endedAt && replay.chunks.length >= 1);
    }, "persisted non-ranked replay", 3000);

    const replayResponse = await fetch(`${serverHttp(colyseus)}/api/matches/${matchId}/replay`);
    const replayBody = await replayResponse.json();
    assert.strictEqual(replayResponse.status, 200);
    assert.strictEqual(replayBody.match.id, matchId);
    assert.strictEqual(replayBody.match.ranked, false);
    assert.ok(replayBody.chunks[0].frames.length >= 1);

    await p1.leave();
    await p2.leave();
  });

  it("aggregates signed-in user stats from replay capture data", async () => {
    const alpha = await register(colyseus, "stats-alpha@example.com", "ALPHA");
    const beta = await register(colyseus, "stats-beta@example.com", "BETA");

    const matchAsP1 = await matchStore.createMatch({
      roomId: "stats-room-1",
      matchSeq: 1,
      mode: "ranked",
      ranked: true,
      p1UserId: alpha.user.id,
      p2UserId: beta.user.id,
      p1Name: "ALPHA",
      p2Name: "BETA",
      startedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await matchStore.addPoint({ id: `${matchAsP1.id}:point:1`, matchId: matchAsP1.id, seq: 1, timeMs: 100, winner: "p1", reason: "WINNER", server: "p1", p1Score: 1, p2Score: 0, rallyLength: 0, terminalBall: {} });
    await matchStore.addPoint({ id: `${matchAsP1.id}:point:2`, matchId: matchAsP1.id, seq: 2, timeMs: 200, winner: "p2", reason: "FAULT", server: "p2", p1Score: 1, p2Score: 1, rallyLength: 1, terminalBall: {} });
    await matchStore.addShot({ id: `${matchAsP1.id}:shot:1`, matchId: matchAsP1.id, seq: 1, timeMs: 90, pointSeq: 1, exchange: 0, hitter: "p1", isServe: true, contact: {}, outgoing: {}, charge: 0.5, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 10, intent: "serve", smash: true });
    await matchStore.addShot({ id: `${matchAsP1.id}:shot:2`, matchId: matchAsP1.id, seq: 2, timeMs: 150, pointSeq: 1, exchange: 1, hitter: "p2", isServe: false, contact: {}, outgoing: {}, charge: 0, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 99, intent: "drive", smash: true });
    await matchStore.addShot({ id: `${matchAsP1.id}:shot:3`, matchId: matchAsP1.id, seq: 3, timeMs: 190, pointSeq: 2, exchange: 1, hitter: "p1", isServe: false, contact: {}, outgoing: {}, charge: 0, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 20, intent: "drive", smash: false });
    await matchStore.addReplayChunk({ matchId: matchAsP1.id, chunkIndex: 0, startMs: 0, endMs: 200, frames: [[0, 0, 0, 0]] });
    await matchStore.finishMatch({ matchId: matchAsP1.id, endedAt: new Date("2026-01-01T00:01:00Z"), endedReason: "completed", winner: "p1", p1Score: 11, p2Score: 8, durationMs: 60000, totalPoints: 2, totalShots: 3 });

    const matchAsP2 = await matchStore.createMatch({
      roomId: "stats-room-2",
      matchSeq: 1,
      mode: "ranked",
      ranked: true,
      p1UserId: beta.user.id,
      p2UserId: alpha.user.id,
      p1Name: "BETA",
      p2Name: "ALPHA",
      startedAt: new Date("2026-01-02T00:00:00Z"),
    });
    await matchStore.addPoint({ id: `${matchAsP2.id}:point:1`, matchId: matchAsP2.id, seq: 1, timeMs: 100, winner: "p2", reason: "FAULT", server: "p1", p1Score: 0, p2Score: 1, rallyLength: 2, terminalBall: {} });
    await matchStore.addPoint({ id: `${matchAsP2.id}:point:2`, matchId: matchAsP2.id, seq: 2, timeMs: 200, winner: "p1", reason: "WINNER", server: "p2", p1Score: 1, p2Score: 1, rallyLength: 3, terminalBall: {} });
    await matchStore.addShot({ id: `${matchAsP2.id}:shot:1`, matchId: matchAsP2.id, seq: 1, timeMs: 90, pointSeq: 1, exchange: 0, hitter: "p2", isServe: true, contact: {}, outgoing: {}, charge: 0.5, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 30, intent: "serve", smash: true });
    await matchStore.addShot({ id: `${matchAsP2.id}:shot:2`, matchId: matchAsP2.id, seq: 2, timeMs: 150, pointSeq: 1, exchange: 1, hitter: "p1", isServe: false, contact: {}, outgoing: {}, charge: 0, aimX: 0, aimDepth: 0.5, spinTop: 0, spinSide: 0, speed: 50, intent: "drive", smash: false });
    await matchStore.finishMatch({ matchId: matchAsP2.id, endedAt: new Date("2026-01-02T00:01:00Z"), endedReason: "completed", winner: "p1", p1Score: 11, p2Score: 9, durationMs: 60000, totalPoints: 2, totalShots: 2 });

    const noAuthResponse = await fetch(`${serverHttp(colyseus)}/api/me/stats`);
    assert.strictEqual(noAuthResponse.status, 401);

    const response = await fetch(`${serverHttp(colyseus)}/api/me/stats`, { headers: { Authorization: `Bearer ${alpha.token}` } });
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.stats.matches, 2);
    assert.strictEqual(data.stats.wins, 1);
    assert.strictEqual(data.stats.losses, 1);
    assert.strictEqual(data.stats.winRate, 0.5);
    assert.strictEqual(data.stats.pointsWon, 2);
    assert.strictEqual(data.stats.pointsLost, 2);
    assert.strictEqual(data.stats.pointWinRate, 0.5);
    assert.strictEqual(data.stats.shots, 3);
    assert.strictEqual(data.stats.smashes, 2);
    assert.strictEqual(data.stats.fastestShotSpeed, 30);
    assert.strictEqual(data.stats.avgShotSpeed, 20);
    assert.strictEqual(data.stats.aces, 1);
    assert.strictEqual(data.stats.winners, 1);
    assert.strictEqual(data.stats.faultsCommitted, 1);
    assert.strictEqual(data.stats.faultsDrawn, 1);
    assert.strictEqual(data.stats.longestRally, 3);
    assert.strictEqual(data.stats.avgRally, 1.5);
    assert.strictEqual(data.stats.recentMatches[0].match.id, matchAsP2.id);
    assert.strictEqual(data.stats.recentMatches[0].viewerSide, "p2");
    assert.strictEqual(data.stats.recentMatches[0].replayReady, false);
    assert.strictEqual(data.stats.recentMatches[1].viewerSide, "p1");
    assert.strictEqual(data.stats.recentMatches[1].replayReady, true);
  });

  it("records each ranked rematch against the same player", async () => {
    const p1Account = await register(colyseus, "ranked-rematch-p1@example.com", "RPONE");
    const p2Account = await register(colyseus, "ranked-rematch-p2@example.com", "RPTWO");
    const room = await colyseus.createRoom<any>("backspin", { ranked: true, mode: "ranked" });
    const sdk1 = new Client(serverWs(colyseus));
    const sdk2 = new Client(serverWs(colyseus));
    sdk1.auth.token = p1Account.token;
    sdk2.auth.token = p2Account.token;
    const p1 = await sdk1.joinById(room.roomId, { ranked: true });
    const p2 = await sdk2.joinById(room.roomId, { ranked: true });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});
    p1.onMessage("rematch", () => {});
    p2.onMessage("rematch", () => {});

    await waitFor(() => room.clients.length === 2, "ranked players joined");
    room.state.phase = "exchange";
    room.state.scoreP1 = 10;
    room.point("p1", "WINNER");
    await waitFor(async () => (await rankedStore.getProfile(p1Account.user.id)).gamesPlayed === 1, "first ranked match persisted");
    const firstMatchId = room.replay.currentMatchId;
    await waitFor(async () => Boolean((await matchStore.getMatchDetails(firstMatchId))?.match.endedAt), "first replay persisted");

    p1.send("rematch");
    p2.send("rematch");
    await waitFor(() => p1.state.toJSON().phase === "serve", "ranked rematch started");
    const secondMatchId = room.replay.currentMatchId;
    assert.notStrictEqual(secondMatchId, firstMatchId);
    room.state.phase = "exchange";
    room.state.scoreP2 = 10;
    room.point("p2", "WINNER");

    await waitFor(async () => (await rankedStore.getProfile(p1Account.user.id)).gamesPlayed === 2, "second ranked match persisted");
    await waitFor(async () => Boolean((await matchStore.getMatchDetails(secondMatchId))?.match.endedAt), "second replay persisted");
    const p1Profile = await rankedStore.getProfile(p1Account.user.id);
    const p2Profile = await rankedStore.getProfile(p2Account.user.id);

    assert.strictEqual(p1Profile.wins, 1);
    assert.strictEqual(p1Profile.losses, 1);
    assert.strictEqual(p2Profile.wins, 1);
    assert.strictEqual(p2Profile.losses, 1);
    await p1.leave();
    await p2.leave();
  });

  it("finalizes replay data when a ranked player forfeits", async () => {
    const p1Account = await register(colyseus, "forfeit-p1@example.com", "FPONE");
    const p2Account = await register(colyseus, "forfeit-p2@example.com", "FPTWO");
    const room = await colyseus.createRoom<any>("backspin", { ranked: true, mode: "ranked" });
    const sdk1 = new Client(serverWs(colyseus));
    const sdk2 = new Client(serverWs(colyseus));
    sdk1.auth.token = p1Account.token;
    sdk2.auth.token = p2Account.token;
    const p1 = await sdk1.joinById(room.roomId, { ranked: true });
    const p2 = await sdk2.joinById(room.roomId, { ranked: true });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2 && Boolean(room.replay.currentMatchId), "ranked match started");
    const matchId = room.replay.currentMatchId;
    room.stepSimulation(1 / 60);
    await p2.leave();

    await waitFor(async () => (await matchStore.getMatchDetails(matchId))?.match.endedReason === "forfeit", "forfeit replay persisted");
    const details = (await matchStore.getMatchDetails(matchId))!;
    assert.strictEqual(details.match.winner, "p1");
    assert.strictEqual(details.match.endedReason, "forfeit");
    await p1.leave();
  });

  it("does not record casual matches in ranked profiles", async () => {
    const account = await register(colyseus, "casual@example.com", "CASUAL");
    const room = await colyseus.createRoom<any>("backspin", { mode: "public" });
    const p1 = await colyseus.connectTo(room, { name: "CASUAL" });
    const p2 = await colyseus.connectTo(room, { name: "OTHER" });
    p1.onMessage("fx", () => {});
    p2.onMessage("fx", () => {});

    await waitFor(() => room.clients.length === 2, "casual players joined");
    room.state.phase = "exchange";
    room.state.scoreP1 = 10;
    room.point("p1", "WINNER");
    const profile = await rankedStore.getProfile(account.user.id);

    assert.strictEqual(profile.rating, 1200);
    assert.strictEqual(profile.gamesPlayed, 0);
    await p1.leave();
    await p2.leave();
  });
});
