import { aimDepthToTargetZ, aimXToTargetX, targetXToAimX, targetZToAimDepth } from '../shared/backspin-core.js';

const clampUnit = (value) => Math.max(-1, Math.min(1, value));
export const MOVE_AXIS_DEADZONE = 0.05;

const browserNeedsPointerScale = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const chromium = /Chrome|Chromium|Edg\//.test(ua);
  const firefox = /Firefox/.test(ua);
  return (/Apple/.test(navigator.vendor || '') && !chromium) || firefox;
})();

export const pointerScale = () => (browserNeedsPointerScale && window.devicePixelRatio) || 1;

export function pointerEventToNdc(event, ndcX, ndcY, pointerLocked) {
  if (pointerLocked) {
    const scale = pointerScale();
    return {
      x: clampUnit(ndcX + (event.movementX * scale / window.innerWidth) * 2),
      y: clampUnit(ndcY - (event.movementY * scale / window.innerHeight) * 2),
    };
  }
  return {
    x: (event.clientX / window.innerWidth) * 2 - 1,
    y: -(event.clientY / window.innerHeight) * 2 + 1,
  };
}

export function applyPointerVelocity(target, event, x, y) {
  const seconds = event.timeStamp / 1000;
  const dt = seconds - target.lastT;
  if (dt > 0 && dt < 0.1) {
    target.pvx = target.pvx * 0.4 + ((x - target.lastNdcX) / dt) * 0.6;
    target.pvy = target.pvy * 0.4 + ((y - target.lastNdcY) / dt) * 0.6;
  }
  target.lastT = seconds;
  target.lastNdcX = x;
  target.lastNdcY = y;
  target.ndcX = x;
  target.ndcY = y;
}

export function updateAimFromCamera(target, camera) {
  if (!camera) return;
  target.ndc.set(target.ndcX, target.ndcY);
  target.ray.setFromCamera(target.ndc, camera);
  if (!target.ray.ray.intersectPlane(target.aimPlane || target.plane, target.hit)) return;
  target.aimX = targetXToAimX(target.hit.x);
  target.aimDepth = targetZToAimDepth('p1', target.hit.z);
}

export function aimTargetFromInput(aimX, aimDepth) {
  return { x: aimXToTargetX(aimX), z: aimDepthToTargetZ('p1', aimDepth) };
}
