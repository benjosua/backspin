import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";
import { NET, stepPaddleX } from "../src/shared/backspin-core.js";

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
