import assert from "node:assert/strict";
import { describe, it } from "mocha";
import {
  CONTACT,
  TABLE,
  aimDepthToTargetZ,
  aimXToTargetX,
  targetZToAimDepth,
  aimDifficulty,
  contactAccuracy,
  resolvePlayerShot,
  shotTuning,
  simulateReceiverContact,
} from "../../src/shared/game-core.js";

const baseInput = { charge: 0, chargeHeldMs: 0, charging: false, swipeX: 0, swipeY: 0, aimX: 0, aimDepth: 0.5, paddleVx: 0 };
const context = (y: number, extra: Record<string, any> = {}) => ({
  side: "p1",
  ball: { x: 0, y, z: CONTACT.racketZ },
  incomingVelocity: { x: 0, y: 0, z: 8 },
  offset: 0,
  exchange: 1,
  ...extra,
});

describe("continuous skill shot model", () => {
  it("lets charged low balls attempt attack instead of block or drive", () => {
    const shot = resolvePlayerShot(context(0.62), { ...baseInput, charge: 0.72, charging: true, aimDepth: 0.55 }, { random: () => 0.5 });

    assert.equal(shot.intent, "attack");
    assert.ok(shot.attack > 0, "charged low ball should have attack strength");
    assert.ok(shot.flightTime < 0.68, "attack should be faster than neutral drive");
  });

  it("makes high charged balls stronger than low charged balls continuously", () => {
    const low = resolvePlayerShot(context(0.62), { ...baseInput, charge: 0.82, charging: true }, { random: () => 0.5 });
    const high = resolvePlayerShot(context(1.65), { ...baseInput, charge: 0.82, charging: true }, { random: () => 0.5 });

    assert.equal(high.intent, "attack");
    assert.ok(high.attack > low.attack, `expected high attack ${high.attack} > low ${low.attack}`);
    assert.ok(Math.hypot(high.velocity.x, high.velocity.z) > Math.hypot(low.velocity.x, low.velocity.z));
  });

  it("maps rally aim depth across short and deep opponent table", () => {
    const short = resolvePlayerShot(context(1), { ...baseInput, aimDepth: 0 }, { random: () => 0.5 });
    const deep = resolvePlayerShot(context(1), { ...baseInput, aimDepth: 1 }, { random: () => 0.5 });

    assert.ok(Math.abs(short.target.z) < TABLE.halfLength * 0.3, `short target too deep: ${short.target.z}`);
    assert.ok(Math.abs(deep.target.z) > TABLE.halfLength * 0.85, `deep target too short: ${deep.target.z}`);
  });


  it("keeps aim helper mapping exact enough for short corner shots", () => {
    const shot = resolvePlayerShot(context(1), { ...baseInput, aimX: 1, aimDepth: 0 }, { random: () => 0.5 });

    assert.equal(shot.target.x, aimXToTargetX(1));
    assert.equal(shot.target.z, aimDepthToTargetZ("p1", 0));
    assert.equal(targetZToAimDepth("p1", shot.target.z), 0);
    assert.ok(shot.target.x > TABLE.halfWidth * 0.9, `right corner target too centered: ${shot.target.x}`);
    assert.ok(Math.abs(shot.target.z) < TABLE.halfLength * 0.25, `short target too deep: ${shot.target.z}`);
  });

  it("keeps visible side spin influence on receiver contact path", () => {
    const neutral = resolvePlayerShot(context(1), { ...baseInput, swipeX: 0 }, { random: () => 0.5, swipeSideScale: 0.2 });
    const spun = resolvePlayerShot(context(1), { ...baseInput, swipeX: 4 }, { random: () => 0.5, swipeSideScale: 0.2 });
    const neutralContact = simulateReceiverContact(context(1).ball, neutral.velocity, neutral.spin.top, neutral.spin.side, "p1");
    const spunContact = simulateReceiverContact(context(1).ball, spun.velocity, spun.spin.top, spun.spin.side, "p1");

    assert.ok(Math.abs(spun.spin.side) > Math.abs(neutral.spin.side));
    assert.ok(Math.abs((spunContact.contact?.x ?? 0) - (neutralContact.contact?.x ?? 0)) > 0.08);
  });

  it("makes difficult high-power corner spin less accurate continuously", () => {
    const easy = contactAccuracy(context(1), { ...baseInput, charge: 0.25, aimX: 0, aimDepth: 0.5, swipeX: 0, swipeY: 0, paddleVx: 0 });
    const hard = contactAccuracy(context(1, { offset: 0.72 }), { ...baseInput, charge: 1, aimX: 1, aimDepth: 1, swipeX: 5, swipeY: 5, paddleVx: 8 });

    assert.ok(hard < easy, `expected hard accuracy ${hard} < easy ${easy}`);
    assert.ok(aimDifficulty(1, 1, 1) > aimDifficulty(0, 0.5, 0.25));
  });

  it("exposes shot tuning as numeric modifiers without quality buckets", () => {
    const easy = shotTuning("attack", 0.9, 0.8, { top: 0.2, side: 0.1 }, 1.2, 0.5);
    const hard = shotTuning("attack", 0.35, 0.8, { top: 0.9, side: 0.8 }, 0.65, 1);

    assert.ok(easy.flightTime < hard.flightTime);
    assert.ok(hard.targetError > easy.targetError);
    assert.ok(hard.spinScale < easy.spinScale);
  });

  it("does not perturb requested aim target or expose artificial risk fields", () => {
    const left = resolvePlayerShot(context(0.8, { offset: 0.8 }), { ...baseInput, charge: 1, aimX: 1, aimDepth: 1, swipeX: 5, swipeY: 5 }, { random: () => 0 });
    const right = resolvePlayerShot(context(0.8, { offset: 0.8 }), { ...baseInput, charge: 1, aimX: 1, aimDepth: 1, swipeX: 5, swipeY: 5 }, { random: () => 1 });

    assert.equal(left.target.x, right.target.x);
    assert.equal(left.target.z, right.target.z);
    assert.equal(Object.hasOwn(left, "risk"), false);
    assert.equal(Object.hasOwn(left, "targetError"), false);
  });
});

describe("continuous attack charge timing", () => {
  it("keeps released charge available briefly for the next contact", async () => {
    const { createGame, submitInput, advanceGame } = await import("../../src/shared/game-core.js");
    const state = createGame({ firstServer: "p1", seed: 7 });
    state.phase = "exchange";
    submitInput(state, { side: "p1", charging: true });
    for (let i = 0; i < 48; i += 1) advanceGame(state, 1 / 60);
    const charged = state.players.p1.charge;
    submitInput(state, { side: "p1", charging: false });
    advanceGame(state, 0.12);

    assert.ok(charged > 0.7, `expected charge buildup, got ${charged}`);
    assert.ok(state.players.p1.charge > 0.55, `released attack charge should persist briefly, got ${state.players.p1.charge}`);
  });

  it("charged attack has clearly higher horizontal speed than an uncharged drive", () => {
    const ctx = context(1.2);
    const drive = resolvePlayerShot(ctx, { ...baseInput, charge: 0.2, aimDepth: 0.6 }, { random: () => 0.5 });
    const attack = resolvePlayerShot(ctx, { ...baseInput, charge: 1, charging: true, aimDepth: 0.6 }, { random: () => 0.5 });
    const driveSpeed = Math.hypot(drive.velocity.x, drive.velocity.z);
    const attackSpeed = Math.hypot(attack.velocity.x, attack.velocity.z);

    assert.equal(attack.intent, "attack");
    assert.ok(attackSpeed >= driveSpeed * 1.45, `attack speed ${attackSpeed} should be much faster than drive ${driveSpeed}`);
  });
});
