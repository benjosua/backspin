import { TABLE, PHYSICS, clamp, sideDir, solveLegalServe, solveReachableShot, simulateReceiverContact } from './backspin-core.js';

export const BOT_OFF_TABLE_MARGIN = 0.25;
export const BOT_MAX_OFF_TABLE_X = TABLE.halfWidth + BOT_OFF_TABLE_MARGIN;

export const BOTS = [
  { id: 'rookie', name: 'ROOKIE', tag: 'Still learning the table', minDepth: 0.58, maxDepth: 0.78, skill: 0.28, paddleSpeed: 7.6, react: 4.6, reactionDelay: 0.21, serveReact: 0.11, servePredict: 0.36, predict: 0.17, error: 0.17, spin: 0.2, aggression: 0.14, placement: 0.22, smashChance: 0, wrongFoot: 0, catchup: 0.95, confSwing: 0.12, serveSpin: 0.22 },
  { id: 'pro', name: 'PRO', tag: 'Brings real heat', skill: 0.68, paddleSpeed: 12.4, react: 7.8, reactionDelay: 0.07, predict: 0.74, error: 0.055, spin: 0.68, aggression: 0.55, placement: 0.62, smashChance: 0.48, wrongFoot: 0.22, catchup: 0.42, confSwing: 0.2, serveSpin: 0.78 },
  { id: 'master', name: 'MASTER', tag: 'Do not blink', skill: 0.9, paddleSpeed: 15.5, react: 9.5, reactionDelay: 0, predict: 0.95, error: 0.025, spin: 0.95, aggression: 0.82, placement: 0.85, smashChance: 0.8, wrongFoot: 0.42, catchup: 0.08, confSwing: 0.26, serveSpin: 1 },
];

export const DEFAULT_DIFFICULTY = 'rookie';
export const BOT_BY_ID = Object.fromEntries(BOTS.map((bot) => [bot.id, bot]));
export const getBot = (id) => BOT_BY_ID[id] || BOT_BY_ID.rookie;

export function makeBrain() {
  return { confidence: 0.5 };
}

export function resetBrain(brain) {
  brain.confidence = 0.5;
}

export function updateBrain(brain, botWonPoint, pointQuality = 0.5) {
  const delta = (botWonPoint ? 1 : -1) * (0.06 + pointQuality * 0.14);
  brain.confidence += delta + (0.5 - brain.confidence) * 0.06;
  brain.confidence = clamp(brain.confidence, 0.08, 0.96);
  return brain.confidence;
}

export function fatiguePenalty(exchange) {
  return Math.min(0.28, Math.max(0, exchange - 5) * 0.014);
}

export function effectiveSkill(bot, brain, botScore, opponentScore, exchange = 0) {
  const confidenceBoost = (brain.confidence - 0.5) * bot.confSwing;
  const catchupPenalty = -bot.catchup * (botScore - opponentScore) * 0.03;
  return clamp(bot.skill + confidenceBoost + catchupPenalty - fatiguePenalty(exchange), 0.2, 0.98);
}

export function clampBotDepth(bot, zDir, targetZ) {
  const depth = Math.abs(targetZ / TABLE.halfLength);
  const minDepth = bot.minDepth ?? 0;
  const maxDepth = bot.maxDepth ?? 1;
  return zDir * clamp(depth, minDepth, maxDepth) * TABLE.halfLength;
}

export function resolveBotServe({ side, ball, bot, brain, botScore = 0, opponentScore = 0, opponentX = 0, random = Math.random }) {
  const zDir = sideDir(side);
  const skill = effectiveSkill(bot, brain, botScore, opponentScore);
  const confidence = brain.confidence;
  const serveSpin = bot.serveSpin * (0.72 + skill * 0.28 + (confidence - 0.5) * bot.confSwing);
  let topSpin = (random() < 0.4 + bot.serveSpin * 0.45 ? 1 : -1) * (0.22 + random() * 0.42) * serveSpin;
  const sideSpin = (random() - 0.5) * 1.55 * serveSpin;
  const awayFromPlayer = opponentX >= 0 ? -1 : 1;
  const placement = bot.placement * 0.48 + bot.aggression * 0.32;
  const targetX = clamp(
    awayFromPlayer * TABLE.halfWidth * (0.44 + placement * 0.4) + sideSpin * TABLE.halfWidth * 0.3 + (random() - 0.5) * TABLE.halfWidth * Math.max(0.08, 0.28 - skill * 0.14),
    -TABLE.halfWidth * 0.92,
    TABLE.halfWidth * 0.92,
  );
  let targetZ = zDir * (0.58 + random() * (0.2 + skill * 0.22)) * TABLE.halfLength;
  targetZ = clampBotDepth(bot, zDir, targetZ);
  const flightTime = clamp(0.68 - bot.serveSpin * 0.14 - skill * 0.12, 0.46, 0.68);
  if (bot.minDepth != null && topSpin < -0.15) topSpin = Math.max(topSpin, -0.22);
  const served = solveLegalServe(ball, targetX, targetZ, flightTime, topSpin, sideSpin, side);
  return { ...served, targetZ, flightTime };
}

export function resolveBotReturn({ side, ball, incomingVelocity, exchange = 0, bot, brain, botScore = 0, opponentScore = 0, opponentX = 0, opponentVx = 0, random = Math.random }) {
  const zDir = sideDir(side);
  const highBall = ball.y > PHYSICS.playerHeight;
  const fatigue = fatiguePenalty(exchange);
  const skill = effectiveSkill(bot, brain, botScore, opponentScore, exchange);
  const confidence = brain.confidence;
  const incomingSpeed = Math.hypot(incomingVelocity.x, incomingVelocity.z);
  const softBall = !highBall && incomingSpeed < 6.2 && ball.y > 0.42;
  const smash = (highBall || softBall) && random() < bot.smashChance * (0.55 + confidence * 0.7) * (1 - fatigue * 0.55);
  const playerHeat = incomingSpeed >= 7.8;
  const lobChance = bot.minDepth == null ? (1 - bot.aggression) * 0.28 : bot.aggression * 0.22 + bot.spin * 0.04;
  const lob = playerHeat && !smash && !highBall && random() < lobChance;
  let flightTime = clamp(0.66 - exchange * 0.013, 0.44, 0.66);
  let topSpin;
  let sideSpin;
  let targetX;
  let targetZ;
  let power = 0;

  if (lob) {
    topSpin = -(0.12 + random() * 0.22);
    sideSpin = (random() - 0.5) * 0.8 * bot.spin;
  } else {
    topSpin = random() < 0.1 + bot.spin * 0.12
      ? -(0.25 + random() * 0.45) * (0.6 + bot.spin)
      : (0.2 + random() * 0.6) * (0.4 + bot.spin) * skill;
    sideSpin = (random() - 0.5) * 1.7 * bot.spin * (0.7 + confidence * 0.5);
  }

  if (Math.abs(opponentVx) > 3 && random() < bot.wrongFoot * confidence) {
    targetX = clamp(((-Math.sign(opponentVx) || 1) * TABLE.halfWidth * (0.45 + bot.aggression * 0.4)) + (random() - 0.5) * TABLE.halfWidth * 0.3, -TABLE.halfWidth * 0.9, TABLE.halfWidth * 0.9);
  } else {
    const away = opponentX >= 0 ? -1 : 1;
    targetX = clamp(-opponentX * (0.3 + bot.placement * 0.4) + away * bot.aggression * TABLE.halfWidth * 0.45 + (random() - 0.5) * TABLE.halfWidth * (1 - bot.aggression), -TABLE.halfWidth * 0.9, TABLE.halfWidth * 0.9);
  }

  if (smash) {
    topSpin = Math.max(topSpin, 0.2);
    flightTime = 0.3;
    targetZ = zDir * (0.72 + random() * 0.2) * TABLE.halfLength;
    power = 0.85;
  } else if (topSpin > 0) {
    flightTime *= 1 - topSpin * 0.24;
    targetZ = zDir * (0.58 + random() * 0.32) * TABLE.halfLength;
  } else if (topSpin < -0.15) {
    flightTime *= 1 + Math.abs(topSpin) * 0.32;
    targetZ = zDir * (0.34 + random() * 0.22) * TABLE.halfLength;
  } else {
    targetZ = zDir * (0.5 + random() * 0.35) * TABLE.halfLength;
  }

  if (lob) {
    flightTime = 0.92 + random() * 0.16;
    targetZ = zDir * (0.5 + random() * 0.16) * TABLE.halfLength;
  }

  targetZ = clampBotDepth(bot, zDir, targetZ);
  if (bot.minDepth != null && topSpin < -0.15) topSpin = Math.max(topSpin, -0.22);

  const reachable = solveReachableShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin, side);
  let velocity = { ...reachable.velocity };
  topSpin = reachable.topSpin;
  sideSpin = reachable.sideSpin;
  targetX = reachable.targetX;

  const error = bot.error * (1.25 - confidence * 0.5) + fatigue * 0.08;
  if (error > 0) {
    const safeVelocity = velocity;
    velocity = {
      x: velocity.x * (1 + (random() - 0.5) * 2 * error),
      y: velocity.y * (1 + (random() - 0.5) * 2 * error),
      z: velocity.z * (1 + (random() - 0.5) * 2 * error * 0.7),
    };
    const contact = simulateReceiverContact(ball, velocity, topSpin, sideSpin, side);
    if (contact.catchableHeight && !contact.reachableX) velocity = safeVelocity;
  }

  return {
    velocity,
    spin: { top: topSpin, side: sideSpin },
    target: { x: targetX, z: targetZ },
    flightTime,
    smash,
    lob,
    power,
    reachAdjusted: reachable.reachAdjusted,
  };
}


export function resolveBotPaddleTarget({ side = 'p2', ball, velocity, spin, phase = 'exchange', lastHitter = null, exchange = 0, bot, currentX = 0, pointSeq = 0, deterministic = false }) {
  const receiver = side === 'player' ? 'ai' : side === 'ai' ? 'player' : side === 'p1' ? 'p2' : 'p1';
  const toward = side === 'player' || side === 'p1' ? velocity.z > 0.1 : velocity.z < -0.1;
  const incoming = phase === 'exchange' && (lastHitter === receiver || (!lastHitter && toward));
  const racketZ = side === 'player' || side === 'p1' ? CONTACT_RACKET_Z : -CONTACT_RACKET_Z;
  let target = 0;

  if (incoming && toward) {
    const fatigue = fatiguePenalty(exchange);
    let predict = bot.predict * (1 - fatigue * 1.15);
    const firstReturn = exchange === 0 && phase === 'exchange';
    if (firstReturn && bot.servePredict != null) predict = Math.max(predict, bot.servePredict);
    const time = clamp((racketZ - ball.z) / (velocity.z || 0.000001), 0, 1.2);
    const predicted = ball.x + velocity.x * time + spin.side * 0.5 * PHYSICS.magnus * time * time;
    target = clamp(ball.x + (predicted - ball.x) * predict, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X);
  } else if (incoming) {
    target = currentX * 0.7;
  }

  if (deterministic) {
    target += Math.sin((exchange + 1) * 2.17 + pointSeq * 0.73) * bot.error * TABLE.halfWidth;
  }
  return clamp(target, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X);
}

const CONTACT_RACKET_Z = 4.8;
const smooth = (current, target, lambda, dt) => target + (current - target) * Math.exp(-lambda * dt);

export function stepBotPaddle({ racket, target, dt, bot, exchange = 0 }) {
  const fatigue = fatiguePenalty(exchange);
  const maxSpeed = bot.paddleSpeed * (1 - fatigue * 0.32);
  const react = bot.react * (1 - fatigue * 0.22);
  const desiredVx = clamp((target - racket.x) * 7, -maxSpeed, maxSpeed);
  racket.vx = smooth(racket.vx, desiredVx, react, dt);
  racket.x = clamp(racket.x + racket.vx * dt, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X);
  return racket;
}
