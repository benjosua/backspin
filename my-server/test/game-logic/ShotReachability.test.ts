import assert from "assert";

import {
  BOT_MAX_OFF_TABLE_X,
  CONTACT,
  NET,
  TABLE,
  advanceGame,
  botInputForState,
  clampPaddleX,
  createGame,
  getBot,
  hit,
  maxReachableContactX,
  resolvePlayerShot,
  simulateReceiverContact,
  serve,
  solveReachableShot,
  submitInput,
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

function assertTargeted(label: string, side: Side, ball: { x: number; y: number; z: number }, shot: Shot) {
  const contact = simulateReceiverContact(ball, shot.velocity, shot.spin.top, shot.spin.side, side);
  assert.ok(Number.isFinite(shot.velocity.x) && Number.isFinite(shot.velocity.y) && Number.isFinite(shot.velocity.z), `${label}: non-finite velocity`);
  if (!contact.bounce) return;
  assert.ok(Math.abs(contact.bounce!.x) <= TABLE.halfWidth * 0.98, `${label}: bounce x off table ${contact.bounce!.x}`);
  assert.ok(Math.sign(contact.bounce!.z) === (side === "p1" ? -1 : 1), `${label}: bounce on wrong side ${contact.bounce!.z}`);
}

describe("game logic shot reachability", () => {

  it("uses wider movement area with a more realistic paddle hitbox", () => {
    const widenedMovementEdge = TABLE.halfWidth + 8;
    const visualPaddleHalfWidth = 0.56;
    const visualHitAllowance = visualPaddleHalfWidth + TABLE.ballRadius + 0.07;

    assert.strictEqual(clampPaddleX(widenedMovementEdge), widenedMovementEdge, "player paddle movement should extend wider than the old 0.5 table inset");
    assert.ok(BOT_MAX_OFF_TABLE_X >= widenedMovementEdge, "bot movement clamp should match widened player movement");
    assert.ok(maxReachableContactX() >= 11.5, "wider movement area should cover extreme spin contact paths without enlarging hitbox");
    assert.ok(CONTACT.reachX <= visualHitAllowance, `paddle hitbox too wide: ${CONTACT.reachX}`);
    assert.ok(CONTACT.assistX <= 0.1, `assist hitbox too forgiving: ${CONTACT.assistX}`);
  });

  it("lets the bot return a right-to-left short cross-court shot after moving into position", () => {
    const state = createGame({ firstServer: "p1", nowMs: 0 });
    state.phase = "exchange";
    state.lastHitter = "p2";
    state.players.p1.x = 3.35;
    state.players.p1.targetX = 3.35;
    submitInput(state, { side: "p1", targetX: 3.35, aimX: -1, aimDepth: 0, swipeX: -8, swipeY: 4, charging: true, speed: 1.6 });
    state.players.p1.charge = 1;

    hit(state, "p1");
    let returned = false;
    while (state.phase === "exchange" && state.nowMs < 2000) {
      submitInput(state, botInputForState(state, "p2", getBot("master")));
      const { events } = advanceGame(state, 1 / 60);
      returned ||= events.some((event) => event?.type === "shot" && event.side === "p2");
    }

    assert.ok(returned, `bot should reach and hit instead of miss; point=${state.pointWinner}:${state.pointReason}`);
  });

  it("lets receivers move forward to reach short cross-court balls near the net", () => {
    const ball = { x: 3.35, y: 0.45, z: racketZ("p1") };
    const shot = resolvePlayerShot(
      { side: "p1", ball, incomingVelocity: { x: 0, y: 0, z: incomingZ("p1") }, offset: 0, exchange: 1 },
      { charge: 0, chargeHeldMs: 0, charging: false, swipeX: -8, swipeY: -4, aimX: -1, aimDepth: 0 },
      { intent: "smash", random: () => 0.5, swipeSideScale: 0.34 },
    );

    const contact = simulateReceiverContact(ball, shot.velocity, shot.spin.top, shot.spin.side, "p1");
    assert.ok(contact.catchableHeight, `short cross-court shot should be catchable by moving forward, contact=${JSON.stringify(contact.contact)}`);
    assert.ok(contact.reachableX, `short cross-court shot should be reachable by movement, contact=${JSON.stringify(contact.contact)} max=${maxReachableContactX()}`);
    assert.ok(contact.contact!.z > -CONTACT.racketZ, `receiver should contact before baseline near net, got z=${contact.contact!.z}`);
  });

  it("keeps every catchable focused player shot reachable by movement", () => {
    const sides: Side[] = ["p1", "p2"];
    const startXs = [-3.35, 0, 3.35];
    const ballYs = [0.45, 0.9, 1.6, 2.4];
    const intents = ["block", "drive", "topspin", "chop", "lob", "counter", "smash"];
    const aimDepths = [0, 0.25, 0.75, 1];
    const charges = [0, 0.5, 1];
    const swipeYs = [-4, 0, 4];

    let checked = 0;
    let catchable = 0;
    for (const side of sides) for (const x of startXs) for (const y of ballYs) for (const intent of intents) {
      for (const direction of [-1, 1]) for (const aimX of [0, 0.75 * direction, direction]) {
        for (const aimDepth of aimDepths) for (const charge of charges) for (const swipeX of [0, 2 * direction, 4 * direction]) for (const swipeY of swipeYs) {
          const ball = { x, y, z: racketZ(side) };
          const shot = resolvePlayerShot(
            { side, ball, incomingVelocity: { x: 0, y: 0, z: incomingZ(side) }, offset: 0, exchange: 1 },
            { charge, chargeHeldMs: charge * 500, charging: charge > 0, swipeX, swipeY, aimX, aimDepth },
            { intent, random: () => 0.5, swipeSideScale: 0.34 },
          );
          const contact = simulateReceiverContact(ball, shot.velocity, shot.spin.top, shot.spin.side, side);

          checked += 1;
          if (!contact.catchableHeight) continue;
          catchable += 1;
          assert.ok(contact.reachableX, `${side} ${intent} contact=${contact.contact?.x} max=${maxReachableContactX()} aim=${aimX} depth=${aimDepth} charge=${charge} swipe=(${swipeX},${swipeY})`);
        }
      }
    }

    assert.strictEqual(checked, 108864);
    assert.strictEqual(catchable, 108864);
  });

  it("keeps all-right serves reachable by wider movement instead of bigger racket collision", () => {
    for (const side of ["p1", "p2"] as Side[]) for (const startX of [0, TABLE.halfWidth + 0.5]) for (const charge of [0, 1]) {
      const state = createGame({ firstServer: side, nowMs: 0 });
      const player = state.players[side];
      state.server = side;
      state.phase = "serve";
      player.x = startX;
      player.targetX = startX;
      player.aimX = 1;
      player.aimDepth = 1;
      player.charge = charge;
      player.swipeX = 8;
      player.swipeY = 0;

      serve(state, side);
      const contact = state.ballPlan?.contact;
      assert.ok(contact?.catchableHeight, `${side} start=${startX} charge=${charge}: serve contact should be catchable height`);
      assert.ok(Math.abs(contact!.x) <= maxReachableContactX(), `${side} start=${startX} charge=${charge}: all-right serve contact ${contact!.x} beyond widened movement reach ${maxReachableContactX()}`);
    }
  });
  it("keeps focused corner-spin player shots targeted without pulling corners inward", () => {
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
          assertTargeted(`${side} ${intent} aim=${aimX} depth=${aimDepth} charge=${charge} swipe=(${swipeX},${swipeY})`, side, ball, shot);
        }
      }
    }

    assert.strictEqual(checked, 108864);
  });

  it("keeps direct solver edge/corner first bounce on the requested table side", () => {
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
          assertTargeted(`${side} direct target=${targetX} depth=${depth} top=${topSpin} side=${sideSpin} time=${flightTime}`, side, ball, shot);
        }
      }
    }

    assert.strictEqual(checked, 43200);
  });
});
