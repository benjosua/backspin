import assert from "assert";

import {
  CONTACT,
  TABLE,
  maxReachableContactX,
  resolvePlayerShot,
  simulateReceiverContact,
  solveReachableShot,
} from "../../src/shared/backspin-core.js";

type Side = "p1" | "p2";

type Shot = {
  velocity: { x: number; y: number; z: number };
  spin: { top: number; side: number };
  target?: { x: number; z: number };
};

function racketZ(side: Side) {
  return side === "p1" ? CONTACT.racketZ : -CONTACT.racketZ;
}

function incomingZ(side: Side) {
  return side === "p1" ? 8 : -8;
}

function targetZ(side: Side, depth: number) {
  return (side === "p1" ? -1 : 1) * depth * TABLE.halfLength;
}

function assertCounterable(label: string, side: Side, ball: { x: number; y: number; z: number }, shot: Shot) {
  const contact = simulateReceiverContact(ball, shot.velocity, shot.spin.top, shot.spin.side, side);
  if (!contact.catchableHeight) return;

  assert.ok(
    contact.reachableX,
    `${label}: contact x=${contact.contact?.x} outside max=${maxReachableContactX()} bounce=${JSON.stringify(contact.bounce)} target=${JSON.stringify(shot.target)} spin=${JSON.stringify(shot.spin)}`,
  );
}

describe("game logic shot reachability", () => {
  it("keeps focused corner-spin player shots counterable when catchable", () => {
    const sides: Side[] = ["p1", "p2"];
    const startXs = [-3.35, 0, 3.35];
    const ballYs = [0.45, 0.9, 1.6, 2.4];
    const intents = ["block", "drive", "topspin", "chop", "lob", "counter", "smash"];
    const aimDepths = [0, 0.25, 0.75, 1];
    const charges = [0, 0.5, 1];
    const swipeYs = [-4, 0, 4];

    let checked = 0;
    for (const side of sides) for (const x of startXs) for (const y of ballYs) for (const intent of intents) {
      for (const direction of [-1, 1]) for (const aimX of [0, 0.75 * direction, direction]) {
        for (const aimDepth of aimDepths) for (const charge of charges) for (const swipeX of [0, 2 * direction, 4 * direction]) for (const swipeY of swipeYs) {
          const ball = { x, y, z: racketZ(side) };
          const shot = resolvePlayerShot(
            { side, ball, incomingVelocity: { x: 0, y: 0, z: incomingZ(side) }, offset: 0, exchange: 1 },
            { charge, chargeHeldMs: charge * 500, charging: charge > 0, swipeX, swipeY, aimX, aimDepth },
            { intent, random: () => 0.5, swipeSideScale: 0.34 },
          );

          checked += 1;
          assertCounterable(`${side} ${intent} aim=${aimX} depth=${aimDepth} charge=${charge} swipe=(${swipeX},${swipeY})`, side, ball, shot);
        }
      }
    }

    assert.strictEqual(checked, 108864);
  });

  it("keeps direct solver edge/corner shots counterable when catchable", () => {
    const sides: Side[] = ["p1", "p2"];
    const startXs = [-3.35, 0, 3.35];
    const ballYs = [0.45, 0.9, 2.4];
    const depths = [0.1, 0.25, 0.6, 0.96];
    const topSpins = [-0.8, -0.35, 0, 0.35, 1];
    const flightTimes = [0.38, 0.5, 0.66, 0.92];

    let checked = 0;
    for (const side of sides) for (const x of startXs) for (const y of ballYs) for (const direction of [-1, 1]) {
      for (const targetX of [direction * 2.793, direction * 2.5, direction * 1.5]) for (const depth of depths) {
        for (const topSpin of topSpins) for (const sideSpin of [direction * -1, direction * -0.5, 0, direction * 0.5, direction]) for (const flightTime of flightTimes) {
          const ball = { x, y, z: racketZ(side) };
          const solved = solveReachableShot(ball, targetX, targetZ(side, depth), flightTime, topSpin, sideSpin, side);
          const shot = { velocity: solved.velocity, spin: { top: solved.topSpin, side: solved.sideSpin }, target: { x: solved.targetX, z: targetZ(side, depth) } };

          checked += 1;
          assertCounterable(`${side} direct target=${targetX} depth=${depth} top=${topSpin} side=${sideSpin} time=${flightTime}`, side, ball, shot);
        }
      }
    }

    assert.strictEqual(checked, 43200);
  });
});
