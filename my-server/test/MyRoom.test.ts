import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import {
  CONTACT,
  NET,
  maxReachableContactX,
  resolvePlayerShot,
  simulateReceiverContact,
  solveReachableShot,
  solveShot,
  stepPaddleX,
} from "../src/shared/backspin-core.js";

function waitFor(check: () => boolean, label: string, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("backspin room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

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
});
