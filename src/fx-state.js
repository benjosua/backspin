// Recovered transient arena/FX state. Original bundle name: IT.

import { getDebugTimeScale } from './debug-tuning.js';

export const MAX_DT = 0.033;
export const clampDt = (dt) => Math.min(dt * getDebugTimeScale(), MAX_DT);

// Exponential smoothing used throughout bundle. Original name: FT.
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export const arenaFx = {
  heat: 0,
  pulse: 0,
  bounce: 0,
  smash: 0,
  score: 0,
  serveCharge: 0,
  exchangeN: 0,
  ix: 0,
  iz: 0,
};

// Original name: LT.
export function raiseFx(key, value) {
  if (value > arenaFx[key]) arenaFx[key] = value;
}

// Original name: RT.
export function resetFx() {
  arenaFx.heat = 0;
  arenaFx.pulse = 0;
  arenaFx.bounce = 0;
  arenaFx.smash = 0;
  arenaFx.score = 0;
  arenaFx.serveCharge = 0;
  arenaFx.exchangeN = 0;
}

export function decayFx(dt) {
  arenaFx.pulse = Math.max(0, arenaFx.pulse - dt * 3.4);
  arenaFx.bounce = Math.max(0, arenaFx.bounce - dt * 3);
  arenaFx.smash = Math.max(0, arenaFx.smash - dt * 1.7);
  arenaFx.score = Math.max(0, arenaFx.score - dt * 1.5);
}
