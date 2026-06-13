export function makeRacket(who, z, options = {}) {
  const playerLike = who === 'player' || who === 'p1';
  return {
    who,
    x: options.x ?? 0,
    y: options.y ?? 0.62,
    z,
    rotX: options.rotX ?? (playerLike ? -0.22 : 0.22),
    rotZ: options.rotZ ?? 0,
    vx: options.vx ?? 0,
    prevX: options.prevX ?? 0,
    flash: options.flash ?? 0,
    swing: options.swing ?? 0,
    baseZ: options.baseZ ?? z,
    tell: options.tell ?? 0,
  };
}

export function makeSpin() {
  return { top: 0, side: 0 };
}

export function makeShadow() {
  return { x: 0, z: 0, op: 0, scale: 0.5 };
}

export function makeMarker() {
  return { x: 0, z: 0, kickX: 0, kickZ: 0, op: 0, spin: 0, side: 0, smash: 0 };
}

export function makeAim() {
  return { x: 0, z: 0, op: 0, spinX: 0, spinY: 0, power: 0 };
}

export function updateShadow(shadow, ball, table) {
  const tableish = Math.abs(ball.x) < 3.25 && Math.abs(ball.z) < 5.15;
  shadow.x = ball.x;
  shadow.z = ball.z;
  shadow.op = tableish ? Math.max(0.1, Math.min(0.45, 0.45 - ball.y * 0.09)) : 0;
  shadow.scale = 0.5 + ball.y * 0.16;
  return shadow;
}

export function resetMarker(marker) {
  marker.op = 0;
  marker.spin = 0;
  marker.smash = 0;
  return marker;
}
