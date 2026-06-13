import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { TABLE } from "../../src/shared/backspin-core.js";
import { applyBounce, detectNet, detectRacketContact, predictBall, stepBall } from "../../src/shared/backspin-physics.js";
import { currentServer, otherSide, resolveBouncePoint, resolveOutPoint, scorePoint } from "../../src/shared/backspin-rules.js";
import { getBot, resolveBotPaddleTarget, stepBotPaddle } from "../../src/shared/backspin-bot.js";
import { makeRacket } from "../../src/shared/backspin-view-model.js";

describe("shared game abstractions", () => {
  it("keeps tennis-style serve rotation and scoring in one rule helper", () => {
    assert.equal(otherSide("p1"), "p2");
    assert.equal(otherSide("player"), "ai");
    assert.equal(currentServer("p1", 0, 0), "p1");
    assert.equal(currentServer("p1", 2, 0), "p2");
    assert.deepEqual(scorePoint({ scoreA: 10, scoreB: 9, winner: "p1" }), { scoreA: 11, scoreB: 9, over: true, winner: "p1" });
    assert.deepEqual(scorePoint({ scoreA: 10, scoreB: 10, winner: "p2" }), { scoreA: 10, scoreB: 11, over: false, winner: null });
  });

  it("resolves serve bounce legality without room-specific code", () => {
    const first = resolveBouncePoint({ side: "p1", lastHitter: "p1", exchange: 0, serveBounceCount: 0, bouncedReceiver: false });
    assert.equal(first.serveBounceCount, 1);
    assert.equal(first.winner, undefined);

    const wrongFirst = resolveBouncePoint({ side: "p2", lastHitter: "p1", exchange: 0, serveBounceCount: 0, bouncedReceiver: false });
    assert.deepEqual({ winner: wrongFirst.winner, reason: wrongFirst.reason }, { winner: "p2", reason: "FAULT" });

    const out = resolveOutPoint({ lastHitter: "p1", exchange: 1, serveBounceCount: 0, bouncedReceiver: false });
    assert.deepEqual(out, { winner: "p2", reason: "OUT" });
  });

  it("steps and bounces ball using shared pure physics", () => {
    const ball = { x: 0, y: TABLE.ballRadius + 0.01, z: 0 };
    const velocity = { x: 1, y: -1, z: 2 };
    const spin = { top: 0.5, side: 0.25 };
    stepBall(ball, velocity, spin, 1 / 60);
    assert.ok(ball.y < TABLE.ballRadius + 0.01);
    applyBounce(ball, velocity, spin);
    assert.equal(ball.y, TABLE.ballRadius);
    assert.ok(velocity.y > 0);
    assert.ok(spin.top < 0.5);
  });

  it("detects net crossing and racket contact from shared geometry", () => {
    const net = detectNet(0.1, TABLE.netHeight, { x: 0, y: TABLE.netHeight, z: -0.1 });
    assert.ok(net);

    const contact = detectRacketContact({
      side: "p1",
      prev: { x: 0, y: 0.8, z: 4.7 },
      ball: { x: 0.1, y: 0.9, z: 4.9 },
      velocity: { x: 0, y: 0, z: 2 },
      racketX: 0,
      reach: 0.95,
    });
    assert.ok(contact);
    assert.equal(contact.z, 4.8);
  });

  it("shares bot paddle targeting and stepping", () => {
    const bot = getBot("pro");
    const target = resolveBotPaddleTarget({
      side: "p2",
      ball: { x: 1, y: 0.8, z: 0 },
      velocity: { x: 0.5, y: 0, z: -6 },
      spin: { top: 0, side: 0.2 },
      phase: "exchange",
      lastHitter: "p1",
      bot,
      currentX: 0,
    });
    assert.ok(target > 0);
    const racket = makeRacket("p2", -4.8);
    stepBotPaddle({ racket, target, dt: 1 / 60, bot });
    assert.ok(racket.x > 0);
    assert.ok(racket.vx > 0);
  });

  it("predicts ball forward without allocating room state", () => {
    const ball = { x: 0, y: 1, z: 0 };
    const velocity = { x: 0, y: -3, z: 1 };
    predictBall(ball, velocity, { top: 0, side: 0 }, 0.08);
    assert.ok(ball.z > 0);
    assert.ok(ball.y < 1);
  });
});
