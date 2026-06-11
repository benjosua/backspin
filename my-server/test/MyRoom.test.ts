import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";

import appConfig from "../src/app.config.js";

describe("backspin room", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;

  before(async () => colyseus = await boot(appConfig));
  after(async () => colyseus.shutdown());

  beforeEach(async () => await colyseus.cleanup());

  it("lets a client connect to a public backspin room", async () => {
    const room = await colyseus.createRoom("backspin", { mode: "public" });
    const client = await colyseus.connectTo(room, { name: "PLAYER" });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timed out waiting for room state")), 1000);
      const check = () => {
        if (client.state?.toJSON?.().joined === 1) {
          clearTimeout(timeout);
          resolve();
        }
      };
      client.onStateChange(check);
      check();
    });
    const state = client.state.toJSON();

    assert.strictEqual(client.sessionId, room.clients[0].sessionId);
    assert.strictEqual(state.phase, "waiting");
    assert.strictEqual(state.mode, "public");
    assert.strictEqual(state.joined, 1);
    assert.match(state.roomCode, /^[A-HJ-NP-Z2-9]{5}$/);
  });
});
