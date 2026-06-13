export const TABLE = Object.freeze({ halfLength: 4.75, halfWidth: 2.85, netHeight: 0.5, ballRadius: 0.12, bounceRestitution: 0.82 });
export const NET = Object.freeze({ tickMs: 1000 / 60, patchMs: 1000 / 60, inputSendMs: 1000 / 60, paddleFollow: 10, paddleSpeed: 19, paddleInset: 0.9 });
export const PHYSICS = Object.freeze({ gravity: 30, topspinGravity: 11, magnus: 7.5, speedScale: 1.9, curveScale: 1.7, playerHeight: 1.2 });
export const CONTACT = Object.freeze({ reachX: 0.72, assistX: 0.08, minY: 0.05, maxY: 3.4, racketZ: 4.8, windowMs: 170 });
export const POINT_RESET_DELAY_SECONDS = 0.8;
export const EMOTES = Object.freeze({ 1: '👍', 2: '😅', 3: '🔥', 4: '👋' });

export const BOTS = Object.freeze([
  { id: 'rookie', name: 'ROOKIE', skill: 0.3, paddleSpeed: 7.6, react: 4.6, error: 0.17, spin: 0.2, aggression: 0.14, placement: 0.22, smashChance: 0.02 },
  { id: 'pro', name: 'PRO', skill: 0.68, paddleSpeed: 12.4, react: 7.8, error: 0.055, spin: 0.68, aggression: 0.55, placement: 0.62, smashChance: 0.48 },
  { id: 'master', name: 'MASTER', skill: 0.9, paddleSpeed: 15.5, react: 9.5, error: 0.025, spin: 0.95, aggression: 0.82, placement: 0.85, smashChance: 0.8 },
]);
export const DEFAULT_DIFFICULTY = 'rookie';
export const BOT_BY_ID = Object.fromEntries(BOTS.map((bot) => [bot.id, bot]));
export const BOT_MAX_OFF_TABLE_X = TABLE.halfWidth + NET.paddleInset;
export const AIM_TARGET_X_SCALE = 0.94;
export const AIM_DEPTH_MIN = 0.18;
export const AIM_DEPTH_MAX = 0.96;
export const AIM_DEPTH_RANGE = AIM_DEPTH_MAX - AIM_DEPTH_MIN;
export const getBot = (id) => BOT_BY_ID[id] || BOT_BY_ID[DEFAULT_DIFFICULTY];
export const getEmote = (id) => EMOTES[String(id)] || null;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const otherSide = (side) => (side === 'player' ? 'ai' : side === 'ai' ? 'player' : side === 'p1' ? 'p2' : 'p1');
export const sideDir = (side) => (side === 'player' || side === 'p1' ? -1 : 1);
export const sideIndex = (side) => (side === 'p2' || side === 'ai' ? 'p2' : 'p1');
export const clampPaddleX = (x) => clamp(Number.isFinite(x) ? x : 0, -TABLE.halfWidth - NET.paddleInset, TABLE.halfWidth + NET.paddleInset);
export const maxReachableContactX = () => TABLE.halfWidth + NET.paddleInset + CONTACT.reachX;
export const aimDepthToTableRatio = (aimDepth) => AIM_DEPTH_MIN + clamp(aimDepth, 0, 1) * AIM_DEPTH_RANGE;
export const aimDepthToTargetZ = (side, aimDepth) => sideDir(side) * TABLE.halfLength * aimDepthToTableRatio(aimDepth);
export const targetZToAimDepth = (side, z) => clamp(((z / (sideDir(side) * TABLE.halfLength)) - AIM_DEPTH_MIN) / AIM_DEPTH_RANGE, 0, 1);
export const aimXToTargetX = (aimX) => clamp(clamp(aimX, -1, 1) * TABLE.halfWidth * AIM_TARGET_X_SCALE, -TABLE.halfWidth * 0.96, TABLE.halfWidth * 0.96);
export const targetXToAimX = (x) => clamp(x / (TABLE.halfWidth * AIM_TARGET_X_SCALE), -1, 1);

export function createRng(seed = 1) {
  let s = (Number(seed) >>> 0) || 1;
  return {
    get seed() { return s >>> 0; },
    next() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function currentServer(firstServer, scoreA, scoreB, other = otherSide) {
  const total = scoreA + scoreB;
  const bucket = scoreA >= 10 && scoreB >= 10 ? total : Math.floor(total / 2);
  return bucket % 2 === 0 ? firstServer : other(firstServer);
}

export function scorePoint({ scoreA, scoreB, winner, sideA = 'p1', sideB = 'p2', winScore = 11 }) {
  const nextA = scoreA + (winner === sideA ? 1 : 0);
  const nextB = scoreB + (winner === sideB ? 1 : 0);
  const over = Math.max(nextA, nextB) >= winScore && Math.abs(nextA - nextB) >= 2;
  return { scoreA: nextA, scoreB: nextB, over, winner: over ? winner : null };
}

export function pointQuality(reason, exchange = 0) {
  if (reason === 'WINNER' && exchange === 0) return 0.9;
  if (reason === 'WINNER') return 0.75;
  if (reason === 'NET' || reason === 'OUT' || reason === 'FAULT' || reason === 'MISS') return 0.3;
  return 0.45;
}

export function makeBrain() { return { confidence: 0.5 }; }
export function resetBrain(brain) { brain.confidence = 0.5; return brain; }
export function updateBrain(brain, botWonPoint, quality = 0.5) {
  brain.confidence = clamp(brain.confidence + (botWonPoint ? 1 : -1) * (0.06 + quality * 0.14) + (0.5 - brain.confidence) * 0.06, 0.08, 0.96);
  return brain.confidence;
}
export function fatiguePenalty(exchange = 0) { return Math.min(0.28, Math.max(0, exchange - 5) * 0.014); }
export function effectiveSkill(bot, brain, botScore, opponentScore, exchange = 0) {
  const confidenceBoost = ((brain?.confidence ?? 0.5) - 0.5) * 0.18;
  const catchupPenalty = -(botScore - opponentScore) * 0.025;
  return clamp((bot?.skill ?? 0.5) + confidenceBoost + catchupPenalty - fatiguePenalty(exchange), 0.2, 0.98);
}

export function stepPaddleX(current, target, dt, speed = 1) {
  const safeSpeed = clamp(Number.isFinite(speed) ? speed : 1, 0.5, 1.6);
  const targetX = clampPaddleX(target);
  const vx = clamp((targetX - current) * NET.paddleFollow * safeSpeed, -NET.paddleSpeed * safeSpeed, NET.paddleSpeed * safeSpeed);
  return { x: clampPaddleX(current + vx * Math.max(0, dt)), vx };
}

export function makeRacket(who, z, options = {}) {
  const playerLike = who === 'player' || who === 'p1';
  return { who, x: options.x ?? 0, y: options.y ?? 0.62, z, rotX: options.rotX ?? (playerLike ? -0.22 : 0.22), rotZ: options.rotZ ?? 0, vx: options.vx ?? 0, prevX: options.prevX ?? 0, flash: 0, swing: 0, baseZ: options.baseZ ?? z, tell: 0 };
}
export const makeSpin = () => ({ top: 0, side: 0 });
export const makeShadow = () => ({ x: 0, z: 0, op: 0, scale: 0.5 });
export const makeMarker = () => ({ x: 0, z: 0, kickX: 0, kickZ: 0, op: 0, spin: 0, side: 0, smash: 0 });
export const makeAim = () => ({ x: 0, z: 0, op: 0, spinX: 0, spinY: 0, power: 0 });
export function updateShadow(shadow, ball) { shadow.x = ball.x; shadow.z = ball.z; shadow.op = Math.abs(ball.x) < 3.25 && Math.abs(ball.z) < 5.15 ? clamp(0.45 - ball.y * 0.09, 0.1, 0.45) : 0; shadow.scale = 0.5 + ball.y * 0.16; return shadow; }
export function resetMarker(marker) { marker.op = 0; marker.spin = 0; marker.smash = 0; return marker; }
export function applyMarkerPrediction(marker, prediction) { if (!prediction) return marker; Object.assign(marker, prediction, { op: prediction.in ? 0.36 : 0 }); return marker; }

function accel(spin) { return { x: spin.side * PHYSICS.magnus, y: -(PHYSICS.gravity + spin.top * PHYSICS.topspinGravity), z: 0 }; }
function sampleAt(start, velocity, spin, seconds) {
  const a = accel(spin);
  return { x: start.x + velocity.x * seconds + 0.5 * a.x * seconds * seconds, y: start.y + velocity.y * seconds + 0.5 * a.y * seconds * seconds, z: start.z + velocity.z * seconds };
}
function velocityToLandAt(ball, targetX, targetZ, flightTime, spin) {
  const a = accel(spin);
  return { x: (targetX - ball.x - 0.5 * a.x * flightTime * flightTime) / flightTime, y: (TABLE.ballRadius - ball.y - 0.5 * a.y * flightTime * flightTime) / flightTime, z: (targetZ - ball.z) / flightTime };
}
function timeAtZ(startZ, velocityZ, z) { if (Math.abs(velocityZ) < 0.000001) return null; const t = (z - startZ) / velocityZ; return t > 0 ? t : null; }
function timeToGround(startY, velocityY, spin) {
  const ay = accel(spin).y;
  const c = startY - TABLE.ballRadius;
  const disc = velocityY * velocityY - 2 * ay * c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const t1 = (-velocityY - sqrt) / ay;
  const t2 = (-velocityY + sqrt) / ay;
  return [t1, t2].filter((t) => t > 0.001).sort((a, b) => a - b)[0] ?? null;
}
function bounceVelocity(v, spin) {
  const top = spin.top;
  const side = spin.side;
  return { velocity: { x: v.x + side * PHYSICS.curveScale, y: Math.abs(v.y) * TABLE.bounceRestitution * (1 - Math.max(top, 0) * 0.18), z: v.z + (Math.sign(v.z) || 1) * top * PHYSICS.speedScale }, spin: { top: top * 0.55, side: side * 0.55 } };
}
function velocityAt(v, spin, seconds) { const a = accel(spin); return { x: v.x + a.x * seconds, y: v.y + a.y * seconds, z: v.z }; }
function onTable(p) { return Math.abs(p.x) <= TABLE.halfWidth && Math.abs(p.z) <= TABLE.halfLength; }
function sideOfZ(z) { return z >= 0 ? 'p1' : 'p2'; }
function netEvent(start, velocity, spin, startMs) {
  const t = timeAtZ(start.z, velocity.z, 0);
  if (t == null) return null;
  const p = sampleAt(start, velocity, spin, t);
  return p.y - TABLE.ballRadius * 0.4 <= TABLE.netHeight ? { type: 'net', _t: t, atMs: startMs + t * 1000, ...p } : { type: 'net-clear', _t: t, atMs: startMs + t * 1000, ...p };
}
function timeAtY(startY, velocityY, spin, y) {
  const ay = accel(spin).y;
  const c = startY - y;
  if (Math.abs(ay) < 0.000001) {
    if (Math.abs(velocityY) < 0.000001) return [];
    const t = -c / velocityY;
    return t > 0 ? [t] : [];
  }
  const disc = velocityY * velocityY - 2 * ay * c;
  if (disc < 0) return [];
  const sqrt = Math.sqrt(disc);
  return [(-velocityY - sqrt) / ay, (-velocityY + sqrt) / ay].filter((t) => t >= 0).sort((a, b) => a - b);
}
function timeAtX(startX, velocityX, spin, x) {
  const ax = accel(spin).x;
  const c = startX - x;
  if (Math.abs(ax) < 0.000001) {
    if (Math.abs(velocityX) < 0.000001) return [];
    const t = -c / velocityX;
    return t >= 0 ? [t] : [];
  }
  const disc = velocityX * velocityX - 2 * ax * c;
  if (disc < 0) return [];
  const sqrt = Math.sqrt(disc);
  return [(-velocityX - sqrt) / ax, (-velocityX + sqrt) / ax].filter((t) => t >= 0).sort((a, b) => a - b);
}
function playableContactHeight(p) {
  return p.y >= TABLE.ballRadius - 0.000001 && p.y <= CONTACT.maxY + 0.000001;
}
function reachableContactPoint(p) {
  return playableContactHeight(p) && Math.abs(p.x) <= maxReachableContactX() + 0.000001;
}
function movedReceiverContact(bounce, velocity, spin, receiver, maxT) {
  const receiverDir = receiver === 'p1' ? 1 : -1;
  const reach = maxReachableContactX();
  const candidates = [0, maxT, ...timeAtY(bounce.y, velocity.y, spin, TABLE.ballRadius), ...timeAtY(bounce.y, velocity.y, spin, CONTACT.maxY), ...timeAtX(bounce.x, velocity.x, spin, -reach), ...timeAtX(bounce.x, velocity.x, spin, reach)]
    .filter((t) => t >= 0 && t <= maxT + 0.000001)
    .map((t) => ({ t, p: sampleAt(bounce, velocity, spin, t) }))
    .filter(({ p }) => Math.sign(p.z || receiverDir) === receiverDir && reachableContactPoint(p))
    .sort((a, b) => b.t - a.t);
  return candidates[0] ?? null;
}
function contactAfterBounce({ bounce, velocity, spin, hitter, startMs, bounceTime, maxContactT = null }) {
  const receiver = otherSide(hitter);
  const rz = receiver === 'p1' ? CONTACT.racketZ : -CONTACT.racketZ;
  const t = timeAtZ(bounce.z, velocity.z, rz);
  if (t == null) return null;
  const limitT = maxContactT == null ? t : Math.min(t, maxContactT);
  if (limitT < 0) return null;
  const fixed = sampleAt(bounce, velocity, spin, t);
  const moved = movedReceiverContact(bounce, velocity, spin, receiver, limitT);
  const useFixed = t <= limitT + 0.000001 && reachableContactPoint(fixed);
  const contactT = useFixed ? t : moved?.t;
  if (contactT == null) return null;
  const p = useFixed ? fixed : moved.p;
  return { type: 'contact', atMs: startMs + (bounceTime + contactT) * 1000, side: receiver, x: p.x, y: p.y, z: p.z, catchableHeight: playableContactHeight(p) };
}
function firstBounce(start, velocity, spin, startMs) {
  const t = timeToGround(start.y, velocity.y, spin);
  if (t == null) return null;
  const p = sampleAt(start, velocity, spin, t);
  return { event: { type: 'bounce', atMs: startMs + t * 1000, side: sideOfZ(p.z), ...p }, t, p };
}

export function sampleBallPlan(plan, nowMs) {
  if (!plan) return { x: 0, y: TABLE.ballRadius, z: 0, vx: 0, vy: 0, vz: 0 };
  let start = plan.start;
  let velocity = plan.velocity;
  let spin = plan.spin;
  let baseMs = plan.startMs;
  for (const seg of plan.segments || []) {
    if (nowMs < seg.atMs) break;
    start = { x: seg.x, y: TABLE.ballRadius, z: seg.z };
    velocity = seg.afterVelocity;
    spin = seg.afterSpin;
    baseMs = seg.atMs;
  }
  const t = Math.max(0, (nowMs - baseMs) / 1000);
  const p = sampleAt(start, velocity, spin, t);
  const v = velocityAt(velocity, spin, t);
  return { ...p, vx: v.x, vy: v.y, vz: v.z, spinTop: spin.top, spinSide: spin.side };
}

function makePlan({ kind, hitter, start, velocity, spin, startMs, target }) {
  const events = [];
  const first = firstBounce(start, velocity, spin, startMs);
  if (!first) {
    events.push({ type: 'point', atMs: startMs + 1200, winner: otherSide(hitter), reason: 'OUT' });
    return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [], contact: null };
  }
  const net = netEvent(start, velocity, spin, startMs);
  if (net && net._t < first.t) {
    if (net.type === 'net') {
      events.push(net, { type: 'point', atMs: net.atMs + 80, winner: otherSide(hitter), reason: 'NET' });
      return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [], contact: null };
    }
    events.push(net);
  }
  events.push(first.event);
  if (!onTable(first.p)) {
    events.push({ type: 'point', atMs: first.event.atMs + 80, winner: otherSide(hitter), reason: kind === 'serve' ? 'FAULT' : 'OUT' });
    return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [], contact: null };
  }
  const expectedFirstSide = kind === 'serve' ? hitter : otherSide(hitter);
  if (first.event.side !== expectedFirstSide) {
    events.push({ type: 'point', atMs: first.event.atMs + 80, winner: otherSide(hitter), reason: kind === 'serve' ? 'FAULT' : 'OUT' });
    return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [], contact: null };
  }
  const vAtBounce = velocityAt(velocity, spin, first.t);
  const bounced = bounceVelocity(vAtBounce, spin);
  const segment = { atMs: first.event.atMs, x: first.p.x, z: first.p.z, afterVelocity: bounced.velocity, afterSpin: bounced.spin };
  const bounceStart = { x: first.p.x, y: TABLE.ballRadius, z: first.p.z };

  const netAfterFirst = netEvent(bounceStart, bounced.velocity, bounced.spin, first.event.atMs);
  if (netAfterFirst) {
    if (netAfterFirst.type === 'net') {
      events.push(netAfterFirst, { type: 'point', atMs: netAfterFirst.atMs + 80, winner: otherSide(hitter), reason: kind === 'serve' ? 'FAULT' : 'NET' });
      return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [segment], contact: null };
    }
    events.push(netAfterFirst);
  }

  if (kind === 'serve') {
    const second = firstBounce(bounceStart, bounced.velocity, bounced.spin, first.event.atMs);
    if (!second) {
      events.push({ type: 'point', atMs: first.event.atMs + 1000, winner: otherSide(hitter), reason: 'FAULT' });
      return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [segment], contact: null };
    }
    const secondEvent = { ...second.event, serveSecond: true };
    events.push(secondEvent);
    if (!onTable(second.p) || secondEvent.side !== otherSide(hitter)) {
      events.push({ type: 'point', atMs: secondEvent.atMs + 80, winner: otherSide(hitter), reason: 'FAULT' });
      return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [segment], contact: null };
    }
    const v2 = velocityAt(bounced.velocity, bounced.spin, second.t);
    const bounced2 = bounceVelocity(v2, bounced.spin);
    const contact = contactAfterBounce({ bounce: second.p, velocity: bounced2.velocity, spin: bounced2.spin, hitter, startMs, bounceTime: first.t + second.t });
    if (contact) events.push(contact);
    events.push({ type: 'point', atMs: (contact?.atMs ?? secondEvent.atMs + 850) + CONTACT.windowMs, winner: hitter, reason: 'WINNER' });
    return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [segment, { atMs: secondEvent.atMs, x: second.p.x, z: second.p.z, afterVelocity: bounced2.velocity, afterSpin: bounced2.spin }], contact };
  }

  const second = firstBounce(bounceStart, bounced.velocity, bounced.spin, first.event.atMs);
  const maxContactT = second ? Math.max(0, second.t - 0.001) : null;
  const contact = contactAfterBounce({ bounce: first.p, velocity: bounced.velocity, spin: bounced.spin, hitter, startMs, bounceTime: first.t, maxContactT });
  if (contact) events.push(contact);
  events.push({ type: 'point', atMs: (contact?.atMs ?? first.event.atMs + 850) + CONTACT.windowMs, winner: hitter, reason: 'WINNER' });
  return { id: 0, kind, hitter, startMs, start, velocity, spin, target, events, segments: [segment], contact };
}

export function solveShot(ball, targetX, targetZ, flightTime, topSpin = 0, sideSpin = 0) {
  return velocityToLandAt(ball, targetX, targetZ, flightTime, { top: topSpin, side: sideSpin });
}
export function solveReachableShot(ball, targetX, targetZ, flightTime, topSpin = 0, sideSpin = 0, shooterSide = 'p1') {
  const target = { x: clamp(targetX, -TABLE.halfWidth * 0.96, TABLE.halfWidth * 0.96), z: clamp(targetZ, -TABLE.halfLength * 0.98, TABLE.halfLength * 0.98) };
  const requestedSpin = { top: clamp(topSpin, -0.9, 1), side: clamp(sideSpin, -0.85, 0.85) };
  const requestedFlightTime = clamp(flightTime, 0.36, 1.08);
  const zDir = sideDir(shooterSide);
  const requestedDepth = clamp(Math.abs(target.z) / TABLE.halfLength, 0.12, 0.98);
  const uniq = (values) => values.filter((value, index, array) => array.findIndex((other) => Math.abs(other - value) < 0.000001) === index);
  const targetXPulls = [1, 0.9, 0.75, 0.6, 0.45, 0.25, 0];
  const depthOptions = uniq([requestedDepth, Math.max(requestedDepth, 0.2), Math.max(requestedDepth, 0.32), 0.42, 0.55, 0.68, 0.82].map((n) => clamp(n, 0.12, 0.98)));
  const flightOptions = uniq([requestedFlightTime, requestedFlightTime + 0.06, requestedFlightTime + 0.14, 0.55, 0.68, 0.82, 0.98, 1.08].map((n) => clamp(n, 0.36, 1.08)));
  const sideSpinScales = [1, 0.75, 0.5, 0.25, 0];
  const topSpinScales = [1, 0.7, 0.35, 0];

  for (const xPull of targetXPulls) for (const depth of depthOptions) for (const t of flightOptions) for (const sideScale of sideSpinScales) for (const topScale of topSpinScales) {
    const candidateTarget = {
      x: clamp(target.x * xPull, -TABLE.halfWidth * 0.96, TABLE.halfWidth * 0.96),
      z: zDir * TABLE.halfLength * depth,
    };
    const spin = {
      top: clamp(requestedSpin.top * topScale, -0.9, 1),
      side: clamp(requestedSpin.side * sideScale, -0.85, 0.85),
    };
    const velocity = solveShot(ball, candidateTarget.x, candidateTarget.z, t, spin.top, spin.side);
    const plan = makePlan({ kind: 'rally', hitter: shooterSide, start: ball, velocity, spin, startMs: 0, target: candidateTarget });
    const bounce = plan.events.find((e) => e.type === 'bounce');
    const legalBounce = bounce && onTable(bounce) && bounce.side === otherSide(shooterSide);
    const reachableContact = Boolean(plan.contact && plan.contact.catchableHeight && plan.contact.y >= TABLE.ballRadius - 0.000001 && Math.abs(plan.contact.x) <= maxReachableContactX() + 0.000001);
    if (legalBounce && reachableContact) {
      const adjusted = Math.abs(xPull - 1) > 0.000001 || Math.abs(depth - requestedDepth) > 0.000001 || Math.abs(t - requestedFlightTime) > 0.000001 || Math.abs(sideScale - 1) > 0.000001 || Math.abs(topScale - 1) > 0.000001;
      return { velocity, targetX: candidateTarget.x, topSpin: spin.top, sideSpin: spin.side, reachAdjusted: adjusted, contact: plan.contact };
    }
  }

  const spin = { top: 0, side: 0 };
  const fallbackTarget = { x: 0, z: zDir * TABLE.halfLength * 0.55 };
  const velocity = solveShot(ball, fallbackTarget.x, fallbackTarget.z, 0.82, 0, 0);
  const plan = makePlan({ kind: 'rally', hitter: shooterSide, start: ball, velocity, spin, startMs: 0, target: fallbackTarget });
  return { velocity, targetX: fallbackTarget.x, topSpin: spin.top, sideSpin: spin.side, reachAdjusted: true, contact: plan.contact };
}
export function solveLegalServe(ball, targetX, targetZ, flightTime, topSpin = 0, sideSpin = 0, shooterSide = 'p1') {
  const zDir = sideDir(shooterSide);
  let best = null;
  for (const firstDepth of [0.24, 0.34, 0.44, 0.54, 0.64]) for (const t of [0.3, 0.36, 0.42, 0.5, 0.58]) for (const spinScale of [1, 0.8, 0.55, 0.3, 0]) {
    const firstZ = -zDir * TABLE.halfLength * firstDepth;
    const firstX = clamp(ball.x * 0.55 + targetX * 0.45, -TABLE.halfWidth * 0.85, TABLE.halfWidth * 0.85);
    const spin = { top: clamp(topSpin * spinScale, -0.45, 0.75), side: clamp(sideSpin * spinScale, -0.65, 0.65) };
    const velocity = solveShot(ball, firstX, firstZ, t + (flightTime - 0.6) * 0.12, spin.top, spin.side);
    const plan = makePlan({ kind: 'serve', hitter: shooterSide, start: ball, velocity, spin, startMs: 0, target: { x: targetX, z: targetZ } });
    const second = plan.events.find((e) => e.type === 'bounce' && e.serveSecond);
    const point = plan.events.find((e) => e.type === 'point');
    const legal = second && point?.winner === shooterSide && (!plan.contact || Math.abs(plan.contact.x) <= maxReachableContactX());
    const penalty = second ? Math.hypot((second.x - targetX) / TABLE.halfWidth, (second.z - targetZ) / TABLE.halfLength) + Math.abs(1 - spinScale) * 0.35 : 99;
    if (legal && (!best || penalty < best.penalty)) best = { velocity, targetX, targetZ, topSpin: spin.top, sideSpin: spin.side, reachAdjusted: spinScale !== 1, legalAdjusted: true, contact: { ok: true, bounces: plan.events.filter((e) => e.type === 'bounce'), contact: plan.contact }, penalty };
  }
  if (best) return best;
  const spin = { top: 0, side: 0 };
  const firstZ = -zDir * TABLE.halfLength * 0.42;
  const velocity = solveShot(ball, 0, firstZ, 0.42, 0, 0);
  return { velocity, targetX: 0, targetZ: zDir * TABLE.halfLength * 0.55, topSpin: spin.top, sideSpin: spin.side, reachAdjusted: true, legalAdjusted: true, contact: null, penalty: 999 };
}

export function simulateReceiverContact(ball, velocity, topSpin, sideSpin, shooterSide) {
  const plan = makePlan({ kind: 'rally', hitter: shooterSide, start: ball, velocity, spin: { top: topSpin, side: sideSpin }, startMs: 0, target: null });
  const bounce = plan.events.find((e) => e.type === 'bounce');
  const contact = plan.contact;
  const catchableHeight = Boolean(contact?.catchableHeight);
  const reachableX = Boolean(contact && Math.abs(contact.x) <= maxReachableContactX());
  const point = plan.events.find((e) => e.type === 'point');
  return { ok: catchableHeight && reachableX, reason: catchableHeight ? (reachableX ? 'ok' : 'wide') : point?.reason?.toLowerCase?.() || 'height', bounce, contact, catchableHeight, reachableX };
}
export function simulateLegalServe(ball, velocity, topSpin, sideSpin, shooterSide) {
  const plan = makePlan({ kind: 'serve', hitter: shooterSide, start: ball, velocity, spin: { top: topSpin, side: sideSpin }, startMs: 0, target: null });
  const bounces = plan.events.filter((e) => e.type === 'bounce');
  const point = plan.events.find((e) => e.type === 'point');
  const ok = Boolean(bounces[0]?.side === shooterSide && bounces[1]?.side === otherSide(shooterSide) && point?.winner === shooterSide);
  return { ok, reason: ok ? 'ok' : point?.reason?.toLowerCase?.() || 'fault', bounces, contact: plan.contact, catchableHeight: Boolean(plan.contact?.catchableHeight), reachableX: Boolean(plan.contact && Math.abs(plan.contact.x) <= maxReachableContactX()) };
}


export function aimDifficulty(aimX = 0, aimDepth = 0.5, charge = 0) {
  const corner = Math.abs(clamp(aimX, -1, 1));
  const depth = Math.abs(clamp(aimDepth, 0, 1) - 0.5) * 2;
  return clamp((corner * 0.58 + depth * 0.42) * (0.55 + clamp(charge, 0, 1) * 0.45), 0, 1);
}

export function contactAccuracy(context, input) {
  const offset = Math.abs(clamp(context.offset || 0, -1.5, 1.5));
  const charge = clamp(input.charge || 0, 0, 1);
  const height = context.ball?.y ?? 1;
  const heightSweet = 1 - clamp(Math.abs(height - 1.05) / 1.65, 0, 0.8);
  const movementPenalty = clamp(Math.abs(input.paddleVx || 0) / 14, 0, 1) * 0.18;
  const spinLoad = clamp(Math.hypot(input.swipeX || 0, input.swipeY || 0) / 9, 0, 1);
  const difficulty = aimDifficulty(input.aimX || 0, input.aimDepth ?? 0.5, charge);
  const raw = 1
    - offset * 0.62
    - difficulty * (0.12 + charge * 0.2)
    - spinLoad * charge * 0.2
    - movementPenalty
    + heightSweet * 0.12;
  return clamp(raw, 0.08, 1);
}

export function shotTuning(intent, accuracy, charge, spin, ballHeight = 1, aimDepth = 0.5) {
  const a = clamp(accuracy, 0, 1);
  const c = clamp(charge, 0, 1);
  const high = clamp((ballHeight - 0.55) / 1.25, 0, 1);
  const attack = intent === 'attack' ? c * (0.55 + a * 0.45) * (0.72 + high * 0.5) : 0;
  const depth = aimDepthToTableRatio(aimDepth);
  const spinMag = clamp(Math.hypot(spin.top || 0, spin.side || 0), 0, 1.35);
  const flightTime = clamp(0.72 - c * 0.13 - attack * 0.18 + (1 - a) * 0.16 + (intent === 'chop' ? 0.14 : 0), 0.34, 0.92);
  const targetError = (1 - a) * (0.08 + c * 0.24 + spinMag * 0.08);
  const spinScale = clamp(0.72 + a * 0.38 - c * spinMag * 0.16, 0.42, 1.15);
  return { flightTime, depth: clamp(depth, 0.12, 0.98), targetError, spinScale, attack, heightFactor: 0.72 + high * 0.5 };
}

export function classifyShot(context, input) {
  const charge = clamp(input.charge || 0, 0, 1);
  if (charge >= 0.55) return 'attack';
  if ((input.swipeY || 0) < -1.2) return 'chop';
  if (charge < 0.12) return 'block';
  if ((input.swipeY || 0) > 1.2) return 'topspin';
  return 'drive';
}
export function resolvePlayerShot(context, input, options = {}) {
  const intent = options.intent || classifyShot(context, input);
  const zDir = sideDir(context.side);
  const charge = clamp(input.charge || 0, 0, 1);
  const aimX = clamp(input.aimX || 0, -1, 1);
  const aimDepth = clamp(input.aimDepth ?? 0.55, 0, 1);
  const baseTop = clamp((input.swipeY || 0) * (options.swipeTopScale ?? 0.2) + charge * 0.24, -1, 1.1) * (options.spinScale ?? 1);
  const baseSide = clamp((input.swipeX || 0) * (options.swipeSideScale ?? 0.2) + (input.paddleVx || 0) * (options.paddleSideScale ?? 0), -1, 1) * (options.spinScale ?? 1);
  const accuracy = contactAccuracy(context, input);
  const tuning = shotTuning(intent, accuracy, charge, { top: baseTop, side: baseSide }, context.ball.y, aimDepth);
  let topSpin = baseTop * tuning.spinScale;
  let sideSpin = baseSide * tuning.spinScale;
  let flightTime = tuning.flightTime / (options.powerScale ?? 1);
  let depth = tuning.depth;

  if (intent === 'attack') topSpin = Math.max(topSpin, 0.18 + tuning.attack * 0.32);
  if (intent === 'topspin') topSpin = Math.max(topSpin, 0.3);
  if (intent === 'chop') topSpin = Math.min(topSpin, -0.25);
  if (intent === 'block') { topSpin *= 0.35; sideSpin *= 0.35; flightTime += 0.06; }

  const targetX = aimXToTargetX(aimX);
  const targetZ = zDir * TABLE.halfLength * depth;
  const solved = solveReachableShot(context.ball, targetX, targetZ, flightTime, topSpin, sideSpin, context.side);
  return {
    velocity: solved.velocity,
    spin: { top: solved.topSpin, side: solved.sideSpin },
    target: { x: solved.targetX, z: targetZ },
    flightTime,
    intent,
    smash: intent === 'attack' && tuning.attack > 0.45,
    attack: tuning.attack,
    accuracy,
    reachAdjusted: solved.reachAdjusted,
  };
}

export function predictBounceKick(ball, velocity, spin) {
  const first = firstBounce(ball, velocity, spin, 0);
  if (!first) return null;
  const vAt = velocityAt(velocity, spin, first.t);
  const kicked = bounceVelocity(vAt, spin);
  const after = sampleAt({ x: first.p.x, y: TABLE.ballRadius, z: first.p.z }, kicked.velocity, kicked.spin, 0.18);
  return { x: first.p.x, z: first.p.z, kickX: after.x, kickZ: after.z, spin: clamp(Math.hypot(spin.top, spin.side), 0, 1), side: Math.sign(spin.side) || 1, smash: Math.max(0, spin.top), in: onTable(first.p) };
}

export function updateIncomingProjection(marker, { phase = 'exchange', ball, velocity, spin = { top: 0, side: 0 }, incoming = null } = {}) {
  resetMarker(marker);
  const isIncoming = incoming ?? (phase === 'exchange' && ball && velocity && velocity.z > 0 && ball.z < CONTACT.racketZ + 0.25);
  if (!isIncoming || !ball || !velocity || ball.y <= TABLE.ballRadius) return marker;
  return applyMarkerPrediction(marker, predictBounceKick(ball, velocity, spin));
}

export function createGame({ seed = Date.now(), firstServer = null, nowMs = 0, bot = null } = {}) {
  const rng = createRng(seed);
  const server = firstServer || (rng.next() < 0.5 ? 'p1' : 'p2');
  return { seed, rngSeed: rng.seed, rng, nowMs, phase: 'serve', firstServer: server, server, winner: '', scores: { p1: 0, p2: 0 }, players: { p1: { x: 0, vx: 0, targetX: 0, charge: 0, charging: false, speed: 1, inputSeq: 0, aimX: 0, aimDepth: 0.5, swipeX: 0, swipeY: 0 }, p2: { x: 0, vx: 0, targetX: 0, charge: 0, charging: false, speed: 1, inputSeq: 0, aimX: 0, aimDepth: 0.5, swipeX: 0, swipeY: 0 } }, ballPlan: null, planSeq: 0, eventCursor: 0, lastHitter: null, exchange: 0, pointSeq: 0, pointTimerMs: 0, pointWinner: '', pointReason: '', events: [], bot };
}

export function submitInput(state, input) {
  const side = sideIndex(input.side);
  const p = state.players[side];
  if (!p) return state;
  p.inputSeq = Math.max(p.inputSeq || 0, Number(input.seq) || 0);
  p.targetX = clampPaddleX(input.targetX ?? input.x ?? p.targetX);
  p.aimX = clamp(Number.isFinite(input.aimX) ? Number(input.aimX) : p.aimX, -1, 1);
  p.aimDepth = clamp(Number.isFinite(input.aimDepth) ? Number(input.aimDepth) : p.aimDepth, 0, 1);
  p.swipeX = clamp(Number(input.swipeX ?? input.vx) || 0, -8, 8);
  p.swipeY = clamp(Number(input.swipeY ?? input.vy) || 0, -8, 8);
  p.speed = clamp(Number(input.speed) || 1, 0.5, 1.6);
  if (typeof input.charging === 'boolean') p.charging = input.charging;
  return state;
}

function syncServeBall(state) {
  const s = state.server;
  const x = state.players[s].x;
  return { x, y: 0.96, z: s === 'p1' ? CONTACT.racketZ - 0.45 : -CONTACT.racketZ + 0.45 };
}
function installPlan(state, plan) { plan.id = ++state.planSeq; state.ballPlan = plan; state.eventCursor = 0; return plan; }
export function serve(state, side = state.server) {
  side = sideIndex(side);
  if (state.phase !== 'serve' || state.server !== side) return { state, events: [] };
  const p = state.players[side];
  const ball = syncServeBall(state);
  const zDir = sideDir(side);
  const top = clamp(p.swipeY * 0.12 + p.charge * 0.24, -0.6, 0.7);
  const sideSpin = clamp((p.swipeX || (side === 'p2' ? -0.12 : 0.12)) * 0.1, -0.65, 0.65);
  const targetX = clamp(aimXToTargetX(p.aimX) + sideSpin * TABLE.halfWidth * 0.18, -TABLE.halfWidth * 0.96, TABLE.halfWidth * 0.96);
  const targetZ = aimDepthToTargetZ(side, p.aimDepth);
  const shot = solveLegalServe(ball, targetX, targetZ, 0.66 - p.charge * 0.12, top, sideSpin, side);
  const plan = makePlan({ kind: 'serve', hitter: side, start: ball, velocity: shot.velocity, spin: { top: shot.topSpin, side: shot.sideSpin }, startMs: state.nowMs, target: { x: shot.targetX, z: targetZ } });
  installPlan(state, plan);
  state.phase = 'exchange'; state.lastHitter = side; state.exchange = 0; state.pointWinner = ''; state.pointReason = ''; p.charge = 0; p.charging = false;
  const event = { type: 'shot', side, serve: true, planId: plan.id, atMs: state.nowMs };
  state.events.push(event);
  return { state, events: [event] };
}

export function hit(state, side, contactEvent = null) {
  side = sideIndex(side);
  if (state.phase !== 'exchange' || state.lastHitter === side) return { state, events: [] };
  const p = state.players[side];
  const sample = sampleBallPlan(state.ballPlan, contactEvent?.atMs ?? state.nowMs);
  const ball = contactEvent ? { x: contactEvent.x, y: contactEvent.y, z: contactEvent.z } : { x: sample.x, y: sample.y, z: sample.z };
  const charge = p.charge;
  const shot = resolvePlayerShot({ side, ball, incomingVelocity: { x: sample.vx, y: sample.vy, z: sample.vz }, offset: clamp((ball.x - p.x) / CONTACT.reachX, -1, 1), exchange: state.exchange + 1 }, { charge: p.charge, charging: p.charging, swipeX: p.swipeX, swipeY: p.swipeY, paddleVx: p.vx, aimX: p.aimX, aimDepth: p.aimDepth });
  const plan = makePlan({ kind: 'rally', hitter: side, start: ball, velocity: shot.velocity, spin: shot.spin, startMs: state.nowMs, target: shot.target });
  installPlan(state, plan);
  state.lastHitter = side; state.exchange += 1; p.charge = 0; p.charging = false;
  const event = {
    type: 'shot',
    side,
    serve: false,
    intent: shot.intent,
    smash: shot.smash,
    planId: plan.id,
    atMs: state.nowMs,
    contact: { x: ball.x, y: ball.y, z: ball.z, paddleX: p.x },
    outgoing: { vx: shot.velocity.x, vy: shot.velocity.y, vz: shot.velocity.z },
    charge,
    aimX: p.aimX,
    aimDepth: p.aimDepth,
    spinTop: shot.spin.top,
    spinSide: shot.spin.side,
    speed: Math.hypot(shot.velocity.x, shot.velocity.y, shot.velocity.z),
  };
  state.events.push(event);
  return { state, events: [event] };
}

function awardPoint(state, winner, reason) {
  if (state.phase !== 'exchange' && state.phase !== 'serve') return null;
  state.phase = 'point'; state.pointTimerMs = POINT_RESET_DELAY_SECONDS * 1000; state.pointSeq += 1; state.pointWinner = winner; state.pointReason = reason;
  state.scores[winner] += 1; state.players.p1.charge = 0; state.players.p2.charge = 0; state.players.p1.charging = false; state.players.p2.charging = false;
  const over = Math.max(state.scores.p1, state.scores.p2) >= 11 && Math.abs(state.scores.p1 - state.scores.p2) >= 2;
  if (over) { state.phase = 'over'; state.winner = winner; }
  const event = { type: 'point', atMs: state.nowMs, winner, reason, over, scoreP1: state.scores.p1, scoreP2: state.scores.p2, pointSeq: state.pointSeq };
  state.events.push(event);
  return event;
}

function resetServe(state) {
  state.phase = state.winner ? 'over' : 'serve'; state.server = currentServer(state.firstServer, state.scores.p1, state.scores.p2); state.lastHitter = null; state.ballPlan = null; state.eventCursor = 0; state.exchange = 0; state.pointWinner = ''; state.pointReason = ''; state.players.p1.charge = 0; state.players.p2.charge = 0;
}

export function advanceGame(state, dtSeconds) {
  const events = [];
  const dt = clamp(dtSeconds || 0, 0, 0.25);
  state.nowMs += dt * 1000;
  for (const side of ['p1', 'p2']) {
    const p = state.players[side];
    const stepped = stepPaddleX(p.x, p.targetX, dt, p.speed); p.x = stepped.x; p.vx = stepped.vx;
    const canCharge = state.phase === 'exchange' || (state.phase === 'serve' && state.server === side);
    if (!canCharge) p.charge = 0;
    else if (p.charging) p.charge = clamp(p.charge + dt * 0.95, 0, 1);
    else p.charge = Math.max(0, p.charge - dt * 0.22);
  }
  if (state.phase === 'point') { state.pointTimerMs -= dt * 1000; if (state.pointTimerMs <= 0) resetServe(state); return { state, events }; }
  if (state.phase !== 'exchange' || !state.ballPlan) return { state, events };
  const plan = state.ballPlan;
  while (state.eventCursor < plan.events.length && plan.events[state.eventCursor].atMs <= state.nowMs) {
    const e = plan.events[state.eventCursor++];
    if (e.type === 'net-clear') continue;
    if (e.type === 'bounce') events.push(e);
    else if (e.type === 'contact') {
      const p = state.players[e.side];
      const miss = !e.catchableHeight || Math.abs(e.x - p.x) > CONTACT.reachX + CONTACT.assistX;
      if (miss) events.push(awardPoint(state, otherSide(e.side), e.catchableHeight ? 'WINNER' : 'MISS'));
      else events.push(hit(state, e.side, e).events[0]);
      break;
    } else if (e.type === 'point') {
      events.push(awardPoint(state, e.winner, e.reason));
      break;
    } else events.push(e);
  }
  return { state, events: events.filter(Boolean) };
}

export function botInputForState(state, side = 'p2', bot = getBot('pro')) {
  const p = state.players[side];
  const sample = state.phase === 'exchange' ? sampleBallPlan(state.ballPlan, state.nowMs) : null;
  const receiver = state.lastHitter && otherSide(state.lastHitter) === side;
  let targetX = p.x * 0.8;
  if (receiver && sample) {
    const contact = state.ballPlan?.contact;
    targetX = contact ? contact.x : sample.x;
  } else if (state.phase === 'serve' && state.server === side) targetX = Math.sin((state.pointSeq + 1) * 1.7) * TABLE.halfWidth * 0.25;
  const skill = bot.skill ?? 0.5;
  const noise = Math.sin((state.exchange + 1) * 2.17 + state.pointSeq * 0.73) * (bot.error ?? 0.05) * TABLE.halfWidth;
  return { side, targetX: clamp(targetX + noise, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X), aimX: clamp(-(state.players[otherSide(side)].x / TABLE.halfWidth) * (0.25 + (bot.placement ?? 0.5) * 0.65) + noise * 0.05, -0.95, 0.95), aimDepth: clamp(0.42 + (bot.aggression ?? 0.4) * 0.34, 0.25, 0.92), swipeX: clamp(noise * 2, -8, 8), swipeY: clamp((bot.spin ?? 0.3) * 1.2, -8, 8), speed: clamp((bot.paddleSpeed ?? 10) / NET.paddleSpeed, 0.5, 1.6), charging: receiver || (state.phase === 'serve' && state.server === side && state.nowMs % 900 > 350), seq: (p.inputSeq || 0) + 1 };
}

export function resolveBotPaddleTarget(args) {
  const toward = args.side === 'p1' ? args.velocity.z > 0 : args.velocity.z < 0;
  if (!toward) return clamp(args.currentX * 0.7, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X);
  const rz = args.side === 'p1' ? CONTACT.racketZ : -CONTACT.racketZ;
  const time = clamp((rz - args.ball.z) / (args.velocity.z || 0.000001), 0, 1.2);
  return clamp(args.ball.x + args.velocity.x * time + (args.spin?.side || 0) * 0.5 * PHYSICS.magnus * time * time, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X);
}
export function stepBotPaddle({ racket, target, dt, bot }) { const step = stepPaddleX(racket.x, target, dt, clamp((bot?.paddleSpeed ?? NET.paddleSpeed) / NET.paddleSpeed, 0.5, 1.6)); racket.vx = step.vx; racket.x = clamp(step.x, -BOT_MAX_OFF_TABLE_X, BOT_MAX_OFF_TABLE_X); return racket; }
export function resolveBotServe(args) { const input = botInputForState({ players: { [args.side]: { x: args.ball.x, inputSeq: 0 }, [otherSide(args.side)]: { x: args.opponentX || 0 } }, phase: 'serve', server: args.side, pointSeq: 0, nowMs: 500, exchange: 0 }, args.side, args.bot); const zDir = sideDir(args.side); return solveLegalServe(args.ball, input.aimX * TABLE.halfWidth, zDir * TABLE.halfLength * input.aimDepth, 0.58, input.swipeY * 0.12, input.swipeX * 0.1, args.side); }
export function resolveBotReturn(args) { return resolvePlayerShot({ side: args.side, ball: args.ball, incomingVelocity: args.incomingVelocity, offset: 0, exchange: args.exchange }, { charge: 0.55, charging: true, swipeX: (args.random?.() ?? 0.5) - 0.5, swipeY: args.bot.spin, aimX: -(args.opponentX || 0) / TABLE.halfWidth, aimDepth: 0.45 + args.bot.aggression * 0.35 }, { random: args.random }); }

// Legacy rule helpers kept as compatibility around new event solver.
export function resolveBouncePoint({ side, lastHitter, exchange, serveBounceCount, bouncedReceiver }) {
  if (!lastHitter) return { bouncedReceiver, serveBounceCount };
  if (exchange === 0) {
    const n = serveBounceCount + 1;
    if (n === 1) return side === lastHitter ? { serveBounceCount: n, bouncedReceiver } : { winner: otherSide(lastHitter), reason: 'FAULT', serveBounceCount: n, bouncedReceiver };
    if (n === 2) return side !== lastHitter ? { serveBounceCount: n, bouncedReceiver: true } : { winner: otherSide(lastHitter), reason: 'FAULT', serveBounceCount: n, bouncedReceiver };
    return { winner: lastHitter, reason: 'WINNER', serveBounceCount: n, bouncedReceiver };
  }
  if (side === lastHitter) return { winner: otherSide(lastHitter), reason: 'FAULT', serveBounceCount, bouncedReceiver };
  if (bouncedReceiver) return { winner: lastHitter, reason: 'WINNER', serveBounceCount, bouncedReceiver };
  return { serveBounceCount, bouncedReceiver: true };
}
export function resolveOutPoint({ lastHitter, exchange, serveBounceCount, bouncedReceiver }) { if (!lastHitter) return null; return exchange === 0 && serveBounceCount < 2 ? { winner: otherSide(lastHitter), reason: 'FAULT' } : bouncedReceiver ? { winner: lastHitter, reason: 'WINNER' } : { winner: otherSide(lastHitter), reason: 'OUT' }; }
