export const TABLE = {
  halfLength: 4.75,
  halfWidth: 2.85,
  netHeight: 0.5,
  ballRadius: 0.12,
  bounceRestitution: 0.82,
};

export const PHYSICS = {
  magnus: 7.5,
  speedScale: 1.9,
  curveScale: 1.7,
  playerHeight: 1.2,
};

export const SHOT = {
  smashCharge: 0.45,
  smashHoldMs: 150,
  smashMaxIncomingSpeed: 9,
  counterCharge: 0.55,
  counterMinIncomingSpeed: 15,
  chopSwipeY: -1.2,
  blockCharge: 0.12,
};

export const NET = {
  tickMs: 1000 / 60,
  patchMs: 1000 / 60,
  inputSendMs: 1000 / 60,
  paddleFollow: 10,
  paddleSpeed: 19,
  paddleInset: 0.5,
};

export const EMOTES = {
  1: '👍',
  2: '😅',
  3: '🔥',
  4: '👋',
};

export function getEmote(id) {
  return EMOTES[String(id)] || null;
}

export const CONTACT = {
  reachX: 0.95,
  minY: 0.05,
  maxY: 3.4,
  racketZ: 4.8,
};

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const sideDir = (side) => (side === 'player' || side === 'p1' ? -1 : 1);
export const clampPaddleX = (x) => clamp(x, -TABLE.halfWidth - NET.paddleInset, TABLE.halfWidth + NET.paddleInset);
export const maxReachableContactX = () => TABLE.halfWidth + NET.paddleInset + CONTACT.reachX;

export function stepPaddleX(current, target, dt, speed = 1) {
  const safeSpeed = clamp(Number.isFinite(speed) ? speed : 1, 0.5, 1.6);
  const targetX = clampPaddleX(Number.isFinite(target) ? target : 0);
  const vx = clamp(
    (targetX - current) * NET.paddleFollow * safeSpeed,
    -NET.paddleSpeed * safeSpeed,
    NET.paddleSpeed * safeSpeed,
  );
  const x = clampPaddleX(current + vx * Math.max(0, dt));
  return { x, vx };
}

export function gradeContact(context) {
  const offset = Math.abs(context.offset || 0);
  if (offset < 0.25) return 'perfect';
  if (offset < 0.55) return 'good';
  if (offset < 0.85) return 'weak';
  return 'bad';
}

export function velocityToLandAt(ball, targetX, targetZ, flightTime, gravity, lateralAccel) {
  return {
    x: (targetX - ball.x) / flightTime - lateralAccel * 0.5 * flightTime,
    y: (TABLE.ballRadius - ball.y + gravity * 0.5 * flightTime * flightTime) / flightTime,
    z: (targetZ - ball.z) / flightTime,
  };
}

export function clearsNet(ball, velocity, gravity) {
  if (Math.abs(velocity.z) < 0.01) return false;
  const t = -ball.z / velocity.z;
  if (t <= 0) return true;
  return ball.y + velocity.y * t - gravity * 0.5 * t * t > TABLE.netHeight + TABLE.ballRadius + 0.05;
}

export function solveShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin) {
  const gravity = 30 + topSpin * 11;
  const lateralAccel = sideSpin * PHYSICS.magnus;
  let time = flightTime;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const velocity = velocityToLandAt(ball, targetX, targetZ, time, gravity, lateralAccel);
    if (clearsNet(ball, velocity, gravity)) return velocity;
    time += 0.07;
  }
  return velocityToLandAt(ball, targetX, targetZ, time, gravity, lateralAccel);
}

export function simulateFirstBounce(ball, velocity, topSpin, sideSpin, maxTime = 2.5) {
  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = velocity.x;
  let vy = velocity.y;
  let vz = velocity.z;
  let elapsed = 0;
  const dt = 0.02;
  while (elapsed < maxTime) {
    vx += sideSpin * PHYSICS.magnus * dt;
    vy -= (30 + topSpin * 11) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    elapsed += dt;
    if (vy < 0 && y <= TABLE.ballRadius) {
      return {
        x,
        z,
        time: elapsed,
        ok: Math.abs(x) <= TABLE.halfWidth - TABLE.ballRadius * 0.5 && Math.abs(z) <= TABLE.halfLength - TABLE.ballRadius * 0.5,
      };
    }
  }
  return null;
}

export function solveSafeShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin) {
  let x = targetX;
  let z = targetZ;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const velocity = solveShot(ball, x, z, flightTime, topSpin, sideSpin);
    if (simulateFirstBounce(ball, velocity, topSpin, sideSpin)?.ok) return velocity;
    x *= 0.62;
    z = Math.sign(z || targetZ || 1) * Math.min(Math.abs(z), TABLE.halfLength * (0.68 - attempt * 0.035));
  }
  return solveShot(ball, 0, Math.sign(targetZ || 1) * TABLE.halfLength * 0.42, flightTime, topSpin * 0.55, sideSpin * 0.45);
}

export function simulateReceiverContact(ball, velocity, topSpin, sideSpin, shooterSide, maxTime = 3) {
  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = velocity.x;
  let vy = velocity.y;
  let vz = velocity.z;
  let top = topSpin;
  let side = sideSpin;
  let elapsed = 0;
  let bounced = false;
  let bounce = null;
  const dt = 1 / 240;
  const zDir = sideDir(shooterSide);
  const receiverZ = zDir * CONTACT.racketZ;

  while (elapsed < maxTime) {
    const prevX = x;
    const prevY = y;
    const prevZ = z;
    vx += side * PHYSICS.magnus * dt;
    vy -= (30 + top * 11) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    elapsed += dt;

    if (Math.sign(prevZ) !== Math.sign(z)) {
      const crossT = (0 - prevZ) / (z - prevZ || 0.000001);
      const netY = prevY + (y - prevY) * crossT;
      if (netY - TABLE.ballRadius * 0.4 <= TABLE.netHeight) {
        return { ok: false, reason: 'net', bounce };
      }
    }

    if (!bounced && vy < 0 && y <= TABLE.ballRadius) {
      if (Math.abs(x) > TABLE.halfWidth || Math.abs(z) > TABLE.halfLength || Math.sign(z) !== zDir) {
        return { ok: false, reason: 'out', bounce: { x, z, time: elapsed } };
      }
      bounce = { x, z, time: elapsed };
      y = TABLE.ballRadius;
      vy = Math.abs(vy) * TABLE.bounceRestitution * (1 - Math.max(top, 0) * 0.18);
      const zSign = Math.sign(vz) || 1;
      vz += zSign * top * PHYSICS.speedScale;
      vx += side * PHYSICS.curveScale;
      top *= 0.55;
      side *= 0.55;
      bounced = true;
    }

    if (bounced && (prevZ - receiverZ) * (z - receiverZ) <= 0 && (zDir < 0 ? vz < 0 : vz > 0)) {
      const crossT = (receiverZ - prevZ) / (z - prevZ || 0.000001);
      const contact = {
        x: prevX + (x - prevX) * crossT,
        y: prevY + (y - prevY) * crossT,
        z: receiverZ,
        time: elapsed,
      };
      const catchableHeight = contact.y >= CONTACT.minY && contact.y <= CONTACT.maxY;
      const reachableX = Math.abs(contact.x) <= maxReachableContactX();
      return {
        ok: Boolean(catchableHeight && reachableX),
        reason: catchableHeight ? (reachableX ? 'ok' : 'wide') : 'height',
        bounce,
        contact,
        catchableHeight,
        reachableX,
      };
    }

    if (Math.abs(z) > 8 || Math.abs(x) > 6 || y < -1.6) {
      return { ok: false, reason: 'escaped', bounce };
    }
  }

  return { ok: false, reason: 'timeout', bounce };
}

export function simulateLegalServe(ball, velocity, topSpin, sideSpin, shooterSide, maxTime = 4) {
  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = velocity.x;
  let vy = velocity.y;
  let vz = velocity.z;
  let top = topSpin;
  let side = sideSpin;
  let elapsed = 0;
  let crossedNet = false;
  const bounces = [];
  const dt = 1 / 240;
  const zDir = sideDir(shooterSide);
  const receiverZ = zDir * CONTACT.racketZ;

  while (elapsed < maxTime) {
    const prevX = x;
    const prevY = y;
    const prevZ = z;
    vx += side * PHYSICS.magnus * dt;
    vy -= (30 + top * 11) * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    elapsed += dt;

    if (Math.sign(prevZ) !== Math.sign(z)) {
      const crossT = (0 - prevZ) / (z - prevZ || 0.000001);
      const netY = prevY + (y - prevY) * crossT;
      if (netY - TABLE.ballRadius * 0.4 <= TABLE.netHeight) {
        return { ok: false, reason: 'net', bounces };
      }
      crossedNet = true;
    }

    if (vy < 0 && y <= TABLE.ballRadius) {
      const bounce = { x, z, time: elapsed };
      if (Math.abs(x) > TABLE.halfWidth || Math.abs(z) > TABLE.halfLength) {
        return { ok: false, reason: 'out', bounces: [...bounces, bounce] };
      }

      bounces.push(bounce);
      if (bounces.length === 1 && !(z * zDir < 0)) {
        return { ok: false, reason: crossedNet ? 'missed-server-side' : 'wrong-first-side', bounces };
      }
      if (bounces.length === 2 && !(z * zDir > 0)) {
        return { ok: false, reason: 'wrong-second-side', bounces };
      }
      if (bounces.length >= 3) {
        return { ok: false, reason: 'third-bounce', bounces };
      }

      y = TABLE.ballRadius;
      vy = Math.abs(vy) * TABLE.bounceRestitution * (1 - Math.max(top, 0) * 0.18);
      const zSign = Math.sign(vz) || 1;
      vz += zSign * top * PHYSICS.speedScale;
      vx += side * PHYSICS.curveScale;
      top *= 0.55;
      side *= 0.55;
    }

    if (bounces.length >= 2 && (prevZ - receiverZ) * (z - receiverZ) <= 0 && (zDir < 0 ? vz < 0 : vz > 0)) {
      const crossT = (receiverZ - prevZ) / (z - prevZ || 0.000001);
      const contact = {
        x: prevX + (x - prevX) * crossT,
        y: prevY + (y - prevY) * crossT,
        z: receiverZ,
        time: elapsed,
      };
      const catchableHeight = contact.y >= CONTACT.minY && contact.y <= CONTACT.maxY;
      const reachableX = Math.abs(contact.x) <= maxReachableContactX();
      return {
        ok: Boolean(catchableHeight && reachableX),
        reason: catchableHeight ? (reachableX ? 'ok' : 'wide') : 'height',
        bounces,
        contact,
        catchableHeight,
        reachableX,
      };
    }

    if (Math.abs(z) > 8 || Math.abs(x) > 6 || y < -1.6) {
      return { ok: false, reason: 'escaped', bounces };
    }
  }

  return { ok: false, reason: 'timeout', bounces };
}

export function solveLegalServe(ball, targetX, targetZ, flightTime, topSpin, sideSpin, shooterSide) {
  const zDir = sideDir(shooterSide);
  const serverSign = -zDir;
  const targetScales = [1, 0.85, 0.7, 0.55, 0.4, 0.2, 0];
  const spinScales = [1, 0.85, 0.7, 0.5, 0.3, 0.15, 0];
  const firstBounceTimes = [0.28, 0.34, 0.4, 0.46, 0.52];
  const firstBounceDepths = [0.66, 0.54, 0.42, 0.3, 0.18];
  const firstBounceXRatios = [0.2, 0.35, 0.5, 0.65, 0.8];
  let best = null;
  let nearest = null;

  for (const targetScale of targetScales) {
    for (const spinScale of spinScales) {
      const nextTargetX = targetX * targetScale;
      const nextTopSpin = topSpin * spinScale;
      const nextSideSpin = sideSpin * spinScale;
      const gravity = 30 + nextTopSpin * 11;
      const lateralAccel = nextSideSpin * PHYSICS.magnus;

      for (const t of firstBounceTimes) {
        const firstBounceTime = Math.max(0.22, t + (flightTime - 0.6) * 0.16);
        for (const depth of firstBounceDepths) {
          const firstZ = serverSign * TABLE.halfLength * depth;
          for (const ratio of firstBounceXRatios) {
            const firstX = clamp(ball.x + (nextTargetX - ball.x) * ratio, -TABLE.halfWidth * 0.9, TABLE.halfWidth * 0.9);
            const velocity = velocityToLandAt(ball, firstX, firstZ, firstBounceTime, gravity, lateralAccel);
            const contact = simulateLegalServe(ball, velocity, nextTopSpin, nextSideSpin, shooterSide);
            const secondBounce = contact.bounces?.[1];
            if (!secondBounce) continue;

            const targetDistance = Math.hypot(
              (secondBounce.x - targetX) / TABLE.halfWidth,
              (secondBounce.z - targetZ) / TABLE.halfLength,
            );
            const speedPenalty = Math.max(0, Math.hypot(velocity.x, velocity.z) - 18) * 0.05;
            const penalty = targetDistance
              + Math.abs(1 - targetScale) * 0.5
              + Math.abs(1 - spinScale) * 0.35
              + speedPenalty;
            const candidate = {
              velocity,
              targetX: nextTargetX,
              sideSpin: nextSideSpin,
              topSpin: nextTopSpin,
              reachAdjusted: targetScale !== 1 || spinScale !== 1,
              legalAdjusted: true,
              contact,
              penalty,
            };

            if (!nearest || penalty < nearest.penalty) nearest = candidate;
            if (contact.ok && (!best || penalty < best.penalty)) best = candidate;
          }
        }
      }
    }
  }

  if (best) return best;
  if (nearest?.contact?.catchableHeight && nearest.contact.reachableX) return { ...nearest, reachAdjusted: true };

  const fallbackZ = zDir * TABLE.halfLength * 0.5;
  const fallbackX = 0;
  for (const t of [0.34, 0.4, 0.46, 0.52]) {
    const firstZ = serverSign * TABLE.halfLength * 0.42;
    const velocity = velocityToLandAt(ball, fallbackX, firstZ, t, 30, 0);
    const contact = simulateLegalServe(ball, velocity, 0, 0, shooterSide);
    if (contact.ok) {
      return {
        velocity,
        targetX: fallbackX,
        sideSpin: 0,
        topSpin: 0,
        reachAdjusted: true,
        legalAdjusted: true,
        contact,
      };
    }
  }

  return solveReachableShot(ball, fallbackX, fallbackZ, Math.max(flightTime, 0.62), topSpin * 0.25, 0, shooterSide);
}

export function solveReachableShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin, shooterSide) {
  const targetScales = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0];
  const spinScales = [1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0];
  const candidates = targetScales
    .flatMap((targetScale) => spinScales.map((spinScale) => ({
      targetScale,
      spinScale,
      penalty: Math.abs(1 - targetScale) + Math.abs(1 - spinScale) * 1.5,
    })))
    .sort((a, b) => a.penalty - b.penalty);
  let best = null;

  for (const { targetScale, spinScale, penalty } of candidates) {
    const nextTargetX = targetX * targetScale;
    const nextSideSpin = sideSpin * spinScale;
    const velocity = solveSafeShot(ball, nextTargetX, targetZ, flightTime, topSpin, nextSideSpin);
    const contact = simulateReceiverContact(ball, velocity, topSpin, nextSideSpin, shooterSide);
    const candidate = {
      velocity,
      targetX: nextTargetX,
      sideSpin: nextSideSpin,
      topSpin,
      reachAdjusted: targetScale !== 1 || spinScale !== 1,
      contact,
      penalty,
    };
    if (contact.ok) return candidate;
    if (contact.catchableHeight && (!best || penalty < best.penalty)) best = candidate;
  }

  const zDir = sideDir(shooterSide);
  const fallbackZ = Math.sign(targetZ || zDir || 1) * Math.min(Math.abs(targetZ || TABLE.halfLength * 0.5), TABLE.halfLength * 0.68);
  for (const topScale of [1, 0.7, 0.4, 0]) {
    const nextTopSpin = topSpin * topScale;
    const velocity = solveSafeShot(ball, 0, fallbackZ, Math.max(flightTime, 0.62), nextTopSpin, 0);
    const contact = simulateReceiverContact(ball, velocity, nextTopSpin, 0, shooterSide);
    if (contact.ok) {
      return {
        velocity,
        targetX: 0,
        sideSpin: 0,
        topSpin: nextTopSpin,
        reachAdjusted: true,
        contact,
      };
    }
  }

  if (best?.velocity) return { ...best, reachAdjusted: true };
  return {
    velocity: solveSafeShot(ball, 0, fallbackZ, Math.max(flightTime, 0.62), topSpin * 0.4, 0),
    targetX: 0,
    sideSpin: 0,
    topSpin: topSpin * 0.4,
    reachAdjusted: true,
    contact: null,
  };
}

export function classifyShot(context, input) {
  const charge = clamp(input.charge || 0, 0, 1);
  const swipeY = input.swipeY || 0;
  const highBall = context.ball.y > PHYSICS.playerHeight;
  const incomingSpeed = Math.hypot(context.incomingVelocity.x, context.incomingVelocity.z);
  const offset = Math.abs(context.offset || 0);
  const timing = context.timingGrade || gradeContact(context);
  const chargeHeldMs = input.chargeHeldMs ?? charge * 500;
  const heldEarly = Boolean(input.charging) && chargeHeldMs >= SHOT.smashHoldMs;

  if (highBall && incomingSpeed < SHOT.smashMaxIncomingSpeed && charge > SHOT.smashCharge && heldEarly && timing !== 'bad') return 'smash';
  if (!highBall && incomingSpeed > SHOT.counterMinIncomingSpeed && charge > SHOT.counterCharge && offset < 0.45 && timing !== 'weak' && timing !== 'bad') return 'counter';
  if (swipeY < SHOT.chopSwipeY && incomingSpeed > 12) return 'lob';
  if (swipeY < SHOT.chopSwipeY) return 'chop';
  if (charge < SHOT.blockCharge && Math.abs(swipeY) < 1.2) return 'block';
  if (swipeY > 1.2) return 'topspin';
  return 'drive';
}

export function resolvePlayerShot(context, input, options = {}) {
  const intent = options.intent || classifyShot(context, input);
  const timing = context.timingGrade || gradeContact(context);
  const zDir = sideDir(context.side);
  const charge = clamp(input.charge || 0, 0, 1);
  const offset = clamp(context.offset || 0, -1, 1);
  const spinScale = options.spinScale ?? 1;
  const powerScale = options.powerScale ?? 1;
  const controlScale = Math.max(0.001, options.controlScale ?? 1);
  const swipeTopScale = options.swipeTopScale ?? 0.16;
  const swipeSideScale = options.swipeSideScale ?? 0.14;
  const paddleSideScale = options.paddleSideScale ?? 0;
  const random = options.random || Math.random;
  const hasAimX = Number.isFinite(input.aimX);
  const hasAimDepth = Number.isFinite(input.aimDepth);
  const aimX = clamp(input.aimX || 0, -1, 1);
  const aimDepth = clamp(input.aimDepth ?? 0.5, 0, 1);

  let topSpin = clamp((input.swipeY || 0) * swipeTopScale + charge * 0.2, -1, 1) * spinScale;
  let sideSpin = clamp((input.swipeX || 0) * swipeSideScale + (input.paddleVx || 0) * paddleSideScale, -1, 1) * spinScale;
  topSpin = clamp(topSpin, -1, 1);
  sideSpin = clamp(sideSpin, -1, 1);

  let flightTime = clamp(0.66 - (context.exchange || 0) * 0.01 - charge * 0.12, 0.48, 0.74) / powerScale;
  let depth = 0.58 + random() * 0.24;
  let width = 0.45;
  let control = 0.3 / controlScale;
  let placementWidth = 0.96;
  let minDepth = 0.08;
  let maxDepth = 0.96;

  if (intent === 'smash') {
    topSpin = Math.max(topSpin, 0.35);
    flightTime = 0.42 / powerScale;
    depth = 0.82;
    width = 0.34;
    control = 0.18 / controlScale;
    placementWidth = 0.9;
    minDepth = 0.45;
    maxDepth = 0.96;
  } else if (intent === 'counter') {
    topSpin = Math.max(topSpin, 0.25);
    flightTime = 0.46 / powerScale;
    depth = 0.74;
    width = 0.38;
    control = 0.2 / controlScale;
    placementWidth = 0.92;
    minDepth = 0.36;
    maxDepth = 0.96;
  } else if (intent === 'lob') {
    topSpin = -0.35 * spinScale;
    sideSpin *= 0.5;
    flightTime = 0.92;
    depth = 0.54;
    width = 0.25;
    control = 0.12 / controlScale;
    placementWidth = 0.9;
    minDepth = 0.18;
    maxDepth = 0.92;
  } else if (intent === 'chop') {
    topSpin = clamp(topSpin - 0.45 * spinScale, -0.8, -0.2);
    flightTime = 0.74;
    depth = 0.44;
    width = 0.34;
    control = 0.18 / controlScale;
    placementWidth = 0.9;
    minDepth = 0.08;
    maxDepth = 0.7;
  } else if (intent === 'block') {
    topSpin *= 0.35;
    sideSpin *= 0.35;
    flightTime = 0.62;
    depth = 0.48;
    width = 0.28;
    control = 0.12 / controlScale;
    placementWidth = 0.78;
    minDepth = 0.08;
    maxDepth = 0.7;
  } else if (intent === 'topspin') {
    topSpin = Math.max(topSpin, 0.25);
    flightTime *= 0.9;
    depth = 0.68;
    minDepth = 0.25;
    maxDepth = 0.96;
  }

  if (hasAimDepth) depth = minDepth + (maxDepth - minDepth) * aimDepth;

  if (timing === 'weak') {
    flightTime = Math.max(flightTime, 0.68);
    depth = Math.min(depth, 0.54);
    topSpin *= 0.7;
    sideSpin *= 0.7;
    control *= 0.6;
    placementWidth *= 0.82;
  } else if (timing === 'bad') {
    flightTime = Math.max(flightTime, 0.78);
    depth = Math.min(depth, 0.46);
    topSpin *= 0.45;
    sideSpin *= 0.45;
    control *= 0.45;
    placementWidth *= 0.65;
  }

  flightTime = clamp(flightTime, 0.38, 1.4);
  const targetX = clamp(
    (hasAimX ? aimX * TABLE.halfWidth * placementWidth : offset * TABLE.halfWidth * width) + sideSpin * TABLE.halfWidth * control,
    -TABLE.halfWidth * 0.98,
    TABLE.halfWidth * 0.98,
  );
  const targetZ = zDir * depth * TABLE.halfLength;
  const solved = solveReachableShot(context.ball, targetX, targetZ, flightTime, topSpin, sideSpin, context.side);

  return {
    intent,
    velocity: solved.velocity,
    spin: { top: solved.topSpin, side: solved.sideSpin },
    target: { x: solved.targetX, z: targetZ },
    flightTime,
    timing,
    smash: intent === 'smash' || intent === 'counter',
    tell: intent === 'smash' ? 'smash' : intent === 'lob' ? 'lob' : Math.abs(solved.sideSpin) + Math.abs(solved.topSpin) > 0.35 ? 'spin' : 'none',
    reachAdjusted: solved.reachAdjusted,
  };
}

export function predictBounceKick(ball, velocity, spin) {
  const gravity = 30 + spin.top * 11;
  const discriminant = velocity.y * velocity.y + gravity * 2 * (ball.y - TABLE.ballRadius);
  if (discriminant <= 0 || gravity <= 0) return null;

  const fallTime = (velocity.y + Math.sqrt(discriminant)) / gravity;
  const x = ball.x + velocity.x * fallTime + spin.side * 0.5 * PHYSICS.magnus * fallTime * fallTime;
  const z = ball.z + velocity.z * fallTime;
  if (Math.abs(x) >= TABLE.halfWidth || Math.abs(z) >= TABLE.halfLength) return null;

  const zSign = Math.sign(velocity.z) || 1;
  const kickTime = 0.18;
  const kickVx = velocity.x + spin.side * PHYSICS.curveScale;
  const kickVz = velocity.z + zSign * spin.top * PHYSICS.speedScale;
  const kickSide = spin.side * 0.55;
  const kickX = x + kickVx * kickTime + kickSide * 0.5 * PHYSICS.magnus * kickTime * kickTime;
  const kickZ = z + kickVz * kickTime;

  return {
    x,
    z,
    kickX,
    kickZ,
    spin: clamp(Math.abs(spin.side) + Math.max(0, spin.top) * 0.6, 0, 1),
    side: clamp(spin.side, -1, 1),
    smash: clamp((Math.hypot(velocity.x, velocity.z) - 18) / 12, 0, 1),
  };
}

export const BackspinCore = {
  CONTACT,
  NET,
  clampPaddleX,
  maxReachableContactX,
  stepPaddleX,
  classifyShot,
  gradeContact,
  predictBounceKick,
  resolvePlayerShot,
  simulateReceiverContact,
  simulateLegalServe,
  simulateFirstBounce,
  solveLegalServe,
  solveReachableShot,
  solveSafeShot,
  solveShot,
};
