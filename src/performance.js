export const QUALITY_LEVELS = {
  low: {
    name: 'low',
    maxDpr: 1,
    adaptiveDpr: true,
    minDpr: 0.75,
    bloom: false,
    bloomResolutionScale: 0.45,
    bloomLevels: 1,
    composerMultisampling: 0,
    fxScale: 0.35,
    confettiCount: 60,
    sparkleCount: 18,
    ringCount: 4,
    shockCount: 3,
    impactCount: 4,
  },
  medium: {
    name: 'medium',
    maxDpr: 1.5,
    adaptiveDpr: true,
    minDpr: 0.9,
    bloom: true,
    bloomResolutionScale: 0.5,
    bloomLevels: 2,
    composerMultisampling: 0,
    fxScale: 0.7,
    confettiCount: 120,
    sparkleCount: 32,
    ringCount: 6,
    shockCount: 4,
    impactCount: 5,
  },
  high: {
    name: 'high',
    maxDpr: 1.75,
    adaptiveDpr: true,
    minDpr: 1,
    bloom: true,
    bloomResolutionScale: 0.75,
    bloomLevels: 3,
    composerMultisampling: 0,
    fxScale: 1,
    confettiCount: 240,
    sparkleCount: 56,
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
