import { BOTS, CAMERA, PHYSICS, TABLE, TUNING } from './constants.js';

export const DEBUG_TUNING_STORAGE_KEY = 'backspin.debugTuning.v1';

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
export const debugTuningEnabled = !!params?.has('debug');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function botSnapshot() {
  return Object.fromEntries(BOTS.map((bot) => [bot.id, {
    minDepth: bot.minDepth,
    skill: bot.skill,
    paddleSpeed: bot.paddleSpeed,
    react: bot.react,
    reactionDelay: bot.reactionDelay,
    serveReact: bot.serveReact,
    servePredict: bot.servePredict,
    predict: bot.predict,
    error: bot.error,
    spin: bot.spin,
    aggression: bot.aggression,
    placement: bot.placement,
    smashChance: bot.smashChance,
    wrongFoot: bot.wrongFoot,
    catchup: bot.catchup,
    confSwing: bot.confSwing,
    serveSpin: bot.serveSpin,
  }]));
}

export const debugRuntime = {
  timeScale: 1,
};

const defaults = clone({
  runtime: debugRuntime,
  table: TABLE,
  physics: PHYSICS,
  camera: CAMERA,
  tuning: TUNING,
  bots: botSnapshot(),
});

function assignDeep(target, source) {
  if (!source || typeof source !== 'object') return;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
      assignDeep(target[key], value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
}

function applyBotPatch(patch) {
  if (!patch || typeof patch !== 'object') return;
  for (const bot of BOTS) {
    if (patch[bot.id]) assignDeep(bot, patch[bot.id]);
  }
}


export function getDebugTuningDefaults() {
  return clone(defaults);
}

export function getDebugTuningSnapshot() {
  return clone({
    runtime: { timeScale: debugRuntime.timeScale },
    table: TABLE,
    physics: PHYSICS,
    camera: CAMERA,
    tuning: TUNING,
    bots: botSnapshot(),
  });
}

export function applyDebugTuningPatch(patch, { persist = true } = {}) {
  if (!debugTuningEnabled || !patch || typeof patch !== 'object') return;
  if (patch.runtime) assignDeep(debugRuntime, patch.runtime);
  if (patch.table) assignDeep(TABLE, patch.table);
  if (patch.physics) assignDeep(PHYSICS, patch.physics);
  if (patch.camera) assignDeep(CAMERA, patch.camera);
  if (patch.tuning) assignDeep(TUNING, patch.tuning);
  if (patch.bots) applyBotPatch(patch.bots);
  debugRuntime.timeScale = Math.max(0, Math.min(2, Number(debugRuntime.timeScale) || 0));
  if (persist && typeof localStorage !== 'undefined') {
    localStorage.setItem(DEBUG_TUNING_STORAGE_KEY, JSON.stringify(getDebugTuningSnapshot()));
  }
}

export function setDebugTuningValue(path, value, { persist = true } = {}) {
  const parts = path.split('.');
  let patch = value;
  for (let i = parts.length - 1; i >= 0; i -= 1) patch = { [parts[i]]: patch };
  applyDebugTuningPatch(patch, { persist });
}

export function resetDebugTuning() {
  applyDebugTuningPatch(defaults, { persist: false });
  if (typeof localStorage !== 'undefined') localStorage.removeItem(DEBUG_TUNING_STORAGE_KEY);
}

export function exportDebugTuning() {
  return JSON.stringify(getDebugTuningSnapshot(), null, 2);
}

export function importDebugTuning(json) {
  const patch = JSON.parse(json);
  applyDebugTuningPatch(patch, { persist: true });
}

export function bootstrapDebugTuning() {
  if (!debugTuningEnabled || typeof localStorage === 'undefined') return;
  const saved = localStorage.getItem(DEBUG_TUNING_STORAGE_KEY);
  if (!saved) return;
  try {
    applyDebugTuningPatch(JSON.parse(saved), { persist: false });
  } catch (error) {
    console.warn('[debug tuning] failed to load saved tuning', error);
  }
}

export function getDebugTimeScale() {
  return debugTuningEnabled ? debugRuntime.timeScale : 1;
}

export function getDebugTime(elapsedTime) {
  return debugTuningEnabled ? elapsedTime * debugRuntime.timeScale : elapsedTime;
}
