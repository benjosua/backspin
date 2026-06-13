const clampUnit = (value) => Math.max(-1, Math.min(1, value));

export const inputHud = {
  charge: 0,
  charging: false,
  power: 0,
  spinX: 0,
  spinY: 0,
  spinMag: 0,
  spinLabel: '',
  aimX: 0,
  aimDepth: 0.5,
  aimLabel: '',
  exchange: 0,
  callout: '',
  calloutT: 0,
  calloutColor: '',
  aiConfidence: 0.5,
  cursorVisible: false,
  cursorX: 0,
  cursorY: 0,
};

export function resetInputHud() {
  Object.assign(inputHud, {
    charge: 0,
    charging: false,
    power: 0,
    spinX: 0,
    spinY: 0,
    spinMag: 0,
    spinLabel: '',
    aimX: 0,
    aimDepth: 0.5,
    aimLabel: '',
    exchange: 0,
    callout: '',
    calloutT: 0,
    calloutColor: '',
    cursorVisible: false,
  });
}

export function setInputCallout(text, color = '') {
  inputHud.callout = text;
  inputHud.calloutColor = color;
  inputHud.calloutT = 0.9;
}

export function decayInputCallout(dt) {
  if (inputHud.calloutT <= 0) return;
  inputHud.calloutT -= dt;
  if (inputHud.calloutT <= 0) inputHud.callout = '';
}

export function syncInputHudAimAndSpin(target, { charge = 0, charging = false, exchange = 0, canInfluence = true } = {}) {
  inputHud.charge = canInfluence ? charge : 0;
  inputHud.charging = canInfluence && charging;
  inputHud.exchange = exchange;
  inputHud.aimX = target.aimX;
  inputHud.aimDepth = target.aimDepth;
  inputHud.aimLabel = `${target.aimX < -0.25 ? 'LEFT' : target.aimX > 0.25 ? 'RIGHT' : 'CENTER'} · ${target.aimDepth < 0.35 ? 'SHORT' : target.aimDepth > 0.7 ? 'DEEP' : 'MID'}`;
  inputHud.spinX = clampUnit((target.pvx || 0) * 0.12);
  inputHud.spinY = clampUnit(((target.pvy || 0) + (target.kTop || 0)) * 0.12);
  inputHud.spinMag = Math.min(1, Math.hypot(inputHud.spinX, inputHud.spinY));
  inputHud.spinLabel = Math.abs(inputHud.spinX) > 0.35 ? 'SIDESPIN' : inputHud.spinY > 0.3 ? 'TOPSPIN' : inputHud.spinY < -0.2 ? 'CHOP' : '';
}

export function syncCursorScreen(target) {
  if (typeof window === 'undefined') return;
  inputHud.cursorX = (target.ndcX + 1) * 0.5 * window.innerWidth;
  inputHud.cursorY = (1 - target.ndcY) * 0.5 * window.innerHeight;
}
