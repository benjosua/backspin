import { CONTACT, clamp, clampPaddleX, flipPoint } from '../serve/src/shared/game-core.js';

export const NETWORK_RENDERING = Object.freeze({
  minBallLeadSeconds: 0.018,
  maxBallLeadSeconds: 0.075,
  rttLeadFactor: 0.35,
  maxPaddleExtrapolationSeconds: 0.1,
  remotePaddleFollow: 32,
  fallbackBallFollow: 42,
  fallbackVelocityFollow: 48,
  ballCorrectionRate: 18,
  ballSnapDistance: 2,
  predictedHitTriggerWindowMs: 50,
  predictedHitHoldMs: 120,
});

export function ballLeadSeconds(patchIntervalMs, rttMs) {
  const { minBallLeadSeconds, maxBallLeadSeconds, rttLeadFactor } = NETWORK_RENDERING;
  return clamp(
    (patchIntervalMs + rttMs * rttLeadFactor) / 1000,
    minBallLeadSeconds,
    maxBallLeadSeconds,
  );
}

export function localizeBallPlan(serializedPlan, elapsedMs, flip, receivedAtMs, previousPlan = null) {
  if (!serializedPlan) return null;
  if (previousPlan?.serializedPlan === serializedPlan && previousPlan.flip === flip) return previousPlan;
  let plan;
  try {
    plan = JSON.parse(serializedPlan);
  } catch {
    return null;
  }
  if (!plan?.id) return null;
  if (previousPlan?.id === plan.id && previousPlan.flip === flip) return previousPlan;

  const serverStartMs = Number(plan.startMs) || 0;
  const reportedElapsedMs = Number.isFinite(elapsedMs) ? elapsedMs : plan.elapsedMs;
  const localStartMs = receivedAtMs - Math.max(0, Number(reportedElapsedMs) || 0);
  const flipVelocity = (velocity) => velocity ? {
    x: (Number(velocity.x) || 0) * flip,
    y: Number(velocity.y) || 0,
    z: (Number(velocity.z) || 0) * flip,
  } : velocity;
  const flipSpin = (spin) => spin ? {
    top: Number(spin.top) || 0,
    side: (Number(spin.side) || 0) * flip,
  } : spin;

  return {
    ...plan,
    flip,
    serializedPlan,
    startMs: localStartMs,
    start: flipPoint(plan.start, flip),
    velocity: flipVelocity(plan.velocity),
    spin: flipSpin(plan.spin),
    target: flipPoint(plan.target, flip),
    contact: plan.contact ? {
      ...flipPoint(plan.contact, flip),
      atMs: localStartMs + Math.max(0, (Number(plan.contact.atMs) || 0) - serverStartMs),
    } : plan.contact,
    segments: (plan.segments || []).map((segment) => ({
      ...segment,
      atMs: localStartMs + Math.max(0, (Number(segment.atMs) || 0) - serverStartMs),
      x: (Number(segment.x) || 0) * flip,
      z: (Number(segment.z) || 0) * flip,
      afterVelocity: flipVelocity(segment.afterVelocity),
      afterSpin: flipSpin(segment.afterSpin),
    })),
  };
}

export function extrapolatePaddleX(x, vx, secondsSincePatch) {
  const seconds = clamp(secondsSincePatch, 0, NETWORK_RENDERING.maxPaddleExtrapolationSeconds);
  return clampPaddleX(x + vx * seconds);
}

export function predictedHitHoldActive(hold, planId, phase, nowMs) {
  return Boolean(
    hold
    && phase === 'exchange'
    && hold.planId === planId
    && nowMs - hold.startedAtMs < NETWORK_RENDERING.predictedHitHoldMs
  );
}

export function localContactAtVisualTime({ plan, side, phase, incoming, visualNowMs, paddleX }) {
  const contact = plan?.contact;
  if (phase !== 'exchange' || !incoming || !contact || contact.side !== side) return null;
  if (visualNowMs < contact.atMs || visualNowMs - contact.atMs > NETWORK_RENDERING.predictedHitTriggerWindowMs) return null;
  if (contact.y < CONTACT.minY || contact.y > CONTACT.maxY) return null;
  if (Math.abs(contact.x - paddleX) > CONTACT.reachX + CONTACT.assistX) return null;
  return contact;
}
