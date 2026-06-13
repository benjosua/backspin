import { TABLE, PHYSICS, CONTACT, maxReachableContactX } from './backspin-core.js';

export const GRAVITY_BASE = 30;
export const TOPSPIN_GRAVITY = 11;
export const BALL_STEP = 1 / 120;

export function stepBall(ball, velocity, spin, dt) {
  velocity.x += spin.side * PHYSICS.magnus * dt;
  velocity.y -= (GRAVITY_BASE + spin.top * TOPSPIN_GRAVITY) * dt;
  ball.x += velocity.x * dt;
  ball.y += velocity.y * dt;
  ball.z += velocity.z * dt;
  return { ball, velocity, spin };
}

export function stepBallState(state, dt) {
  state.ballVx += state.spinSide * PHYSICS.magnus * dt;
  state.ballVy -= (GRAVITY_BASE + state.spinTop * TOPSPIN_GRAVITY) * dt;
  state.ballX += state.ballVx * dt;
  state.ballY += state.ballVy * dt;
  state.ballZ += state.ballVz * dt;
  return state;
}

export function applyBounce(ball, velocity, spin) {
  ball.y = TABLE.ballRadius;
  velocity.y = Math.abs(velocity.y) * TABLE.bounceRestitution * (1 - Math.max(spin.top, 0) * 0.18);
  const zSign = Math.sign(velocity.z) || 1;
  velocity.z += zSign * spin.top * PHYSICS.speedScale;
  velocity.x += spin.side * PHYSICS.curveScale;
  spin.top *= 0.55;
  spin.side *= 0.55;
  return { side: ball.z > 0 ? 'p1' : 'p2', ball, velocity, spin };
}

export function applyStateBounce(state) {
  state.ballY = TABLE.ballRadius;
  state.ballVy = Math.abs(state.ballVy) * TABLE.bounceRestitution * (1 - Math.max(state.spinTop, 0) * 0.18);
  const zSign = Math.sign(state.ballVz) || 1;
  state.ballVz += zSign * state.spinTop * PHYSICS.speedScale;
  state.ballVx += state.spinSide * PHYSICS.curveScale;
  state.spinTop *= 0.55;
  state.spinSide *= 0.55;
  return { side: state.ballZ > 0 ? 'p1' : 'p2', state };
}

export function isOnTable(ball) {
  return Math.abs(ball.x) <= TABLE.halfWidth && Math.abs(ball.z) <= TABLE.halfLength;
}

export function isStateBallOnTable(state) {
  return Math.abs(state.ballX) <= TABLE.halfWidth && Math.abs(state.ballZ) <= TABLE.halfLength;
}

export function detectNet(prevZ, prevY, ball, radiusFactor = 0.4) {
  if (Math.sign(prevZ) === Math.sign(ball.z)) return null;
  const t = (0 - prevZ) / (ball.z - prevZ || 0.000001);
  const y = prevY + (ball.y - prevY) * t;
  return y - TABLE.ballRadius * radiusFactor <= TABLE.netHeight ? { t, y } : null;
}

export function detectStateNet(prevZ, prevY, state, radiusFactor = 0.4) {
  if (Math.sign(prevZ) === Math.sign(state.ballZ)) return null;
  const t = (0 - prevZ) / (state.ballZ - prevZ || 0.000001);
  const y = prevY + (state.ballY - prevY) * t;
  return y - TABLE.ballRadius * radiusFactor <= TABLE.netHeight ? { t, y } : null;
}

export function detectRacketContact({ side, prev, ball, velocity, racketX, reach = CONTACT.reachX, maxY = CONTACT.maxY, minY = CONTACT.minY, racketZ = CONTACT.racketZ }) {
  const z = side === 'player' || side === 'p1' ? racketZ : -racketZ;
  if (!(side === 'player' || side === 'p1' ? velocity.z > 0 : velocity.z < 0)) return null;
  if ((prev.z - z) * (ball.z - z) > 0) return null;
  const t = (z - prev.z) / (ball.z - prev.z || 0.000001);
  const x = prev.x + (ball.x - prev.x) * t;
  const y = prev.y + (ball.y - prev.y) * t;
  if (Math.abs(x - racketX) > reach || y < minY || y > maxY) return null;
  return { x, y, z, t };
}

export function detectStateRacketContact({ side, prevX, prevY, prevZ, state, racketX, reach = CONTACT.reachX }) {
  const racketZ = side === 'p1' ? CONTACT.racketZ : -CONTACT.racketZ;
  if (!(side === 'p1' ? state.ballVz > 0 : state.ballVz < 0)) return null;
  if ((prevZ - racketZ) * (state.ballZ - racketZ) > 0) return null;
  const t = (racketZ - prevZ) / (state.ballZ - prevZ || 0.000001);
  const x = prevX + (state.ballX - prevX) * t;
  const y = prevY + (state.ballY - prevY) * t;
  if (Math.abs(x - racketX) > reach || y < CONTACT.minY || y > CONTACT.maxY) return null;
  return { x, y, z: racketZ, t };
}

export function predictBall(ball, velocity, spin, seconds, maxLead = 0.125) {
  let remaining = Math.max(0, Math.min(seconds, maxLead));
  while (remaining > 0) {
    const dt = Math.min(BALL_STEP, remaining);
    const prevY = ball.y;
    stepBall(ball, velocity, spin, dt);
    remaining -= dt;
    if (velocity.y < 0 && prevY > TABLE.ballRadius && ball.y <= TABLE.ballRadius && isOnTable(ball)) {
      applyBounce(ball, velocity, spin);
    }
  }
  return { ball, velocity, spin };
}

export function receiverReachableX() {
  return maxReachableContactX();
}
