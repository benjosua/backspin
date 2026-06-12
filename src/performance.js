export const QUALITY_LEVELS = {
  low: {
    name: 'low',
    maxDpr: 1,
    adaptiveDpr: false,
    minDpr: 0.75,
    fxScale: 0.35,
    confettiCount: 60,
    ringCount: 4,
    shockCount: 3,
    impactCount: 4,
  },
  medium: {
    name: 'medium',
    maxDpr: 1.5,
    adaptiveDpr: false,
    minDpr: 0.9,
    fxScale: 0.7,
    confettiCount: 120,
    ringCount: 6,
    shockCount: 4,
    impactCount: 5,
  },
  high: {
    name: 'high',
    maxDpr: 2.5,
    adaptiveDpr: false,
    minDpr: 1,
    fxScale: 1,
    confettiCount: 240,
    ringCount: 8,
    shockCount: 5,
    impactCount: 6,
  },
};

function queryQuality() {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('quality');
  return QUALITY_LEVELS[value] ? value : null;
}

function deviceQuality() {
  if (typeof window === 'undefined') return 'medium';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse || memory <= 4 || cores <= 4) return 'medium';
  return 'high';
}

export const qualityName = queryQuality() || deviceQuality();
export const perfSettings = QUALITY_LEVELS[qualityName] || QUALITY_LEVELS.medium;
export const perfHudEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf');
