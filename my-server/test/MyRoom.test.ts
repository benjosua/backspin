import assert from "assert";
import { Client } from "@colyseus/sdk";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { rankedStore } from "../src/ranked/store.js";
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

    assert.strictEqual(p1Profile.rating, 1216);
    assert.strictEqual(p2Profile.rating, 1184);
    assert.strictEqual(p1Profile.wins, 1);
    assert.strictEqual(p2Profile.losses, 1);
    assert.strictEqual(p1Profile.gamesPlayed, 1);
    await p1.leave();
    await p2.leave();
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
