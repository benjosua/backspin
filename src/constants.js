import { BOTS, BOT_BY_ID, DEFAULT_DIFFICULTY, getBot } from '../shared/backspin-bot.js';
// Constants reconstructed from the production bundle.

export const TABLE = {
  halfLength: 4.75,       // $w
  halfWidth: 2.85,        // eT
  netHeight: 0.5,         // tT
  ballRadius: 0.12,       // nT
  bounceRestitution: 0.82,// rT
};

export const PLAYER_SPEED = {
  default: 1,
  min: 0.5,
  max: 1.6,
};

export const PHYSICS = {
  gravity: 4.8,           // iT
  serveHeight: 0.95,      // aT
  magnus: 7.5,            // oT
  speedScale: 1.9,        // sT
  curveScale: 1.7,        // cT
  hitReach: 0.5,          // lT
  hitDepth: 0.5,          // uT
  paddleThickness: 0.34,  // dT
  ballVisualRadius: 0.055,// fT
  playerReach: 2.2,       // pT
  playerHeight: 1.2,      // mT
  spinDecay: 0.3,         // hT
  paddleTilt: 0.22,       // gT
};

export const CAMERA = {
  introPosition: [0, 4.2, 12.6],
  introTarget: [0, 0.3, -1.6],
  playPosition: [0, 4.2, 12.3],
  playTarget: [0, -1.2, -3],
  menuDolly: 1.4,
  cameraLag: 0.15,
  desktopPosition: [0, 5.45, 15.85],
  desktopTarget: [0, -1.2, -3],
  mobileScale: 0.7,
  cameraXInfluence: 2.8,
  cameraYOffset: 0.05,
  cameraZBase: 0.34,
  cameraLookAhead: 0.32,
};

export const COLORS = {
  bg: '#edf3f2',
  fog: '#edf3f2',
  floor: '#e5eceb',
  prop: '#eef3f1',
  table: '#0b5f97',
  tableEmissive: '#0f78ad',
  tableSide: '#08456f',
  tableLeg: '#e9ddc9',
  line: '#fbf6ec',
  net: '#ffffff',
  ball: '#ffe8a4',
  player: '#d9665f',
  playerSoft: '#ef8f87',
  ai: '#de7a6d',
  aiSoft: '#ef8f87',
  ink: '#4b4034',
  inkSoft: '#b4a690',
};

export const TUNING = {
  world: { background: '#edf3f2', fog: '#edf3f2', fogDensity: 0.0045 },
  table: {
    lineColor: '#e8dfcf',
    emissive: '#0f78ad',
    hot: '#1b8ec2',
    baseGlow: 0.32,
    heatGlow: 0.46,
    flashGlow: 0.72,
    lineGlow: 1.1,
  },
  background: {
    ringColor: '#9fd5e5',
    ringInner: 6,
    ringWidth: 0.3,
    ringScaleX: 1.23,
    ringScaleZ: 1.41,
    ringY: 0.26,
    ringSegments: 96,
    ringOpacity: 0.48,
  },
  sky: { zenith: '#e7f0f2', edge: '#f8fbff', horizon: 0.58 },
  lighting: { ambient: 0.55, ambColor: '#e8eef0', key: 2.2, keyColor: '#fff4e6', fill: 0.55, fillColor: '#b8cfe8' },
  net: { opacity: 0.45, color: '#d8d2c4' },
  ballTrail: { width: 2.2, length: 4, decay: 7, color: '#fff4dd', attenuationPower: 3.2, local: false, stride: 0, interval: 1 },
  menu: { titleColor: '#fff3e0', titleBoost: 1.35, titleGlowColor: '#ef8f87', titleGlow: 0.45, titleSize: 2.55, titleTracking: 0.24, titleY: 4.9, glassOpacity: 0.86, glassRim: 0.72, cardOpacity: 0.92 },
  scoreboard: {
    scoreFill: '#d9665f',
    scoreFillBoost: 1,
    scoreGlow: '#d9665f',
    scoreFillOpacity: 1,
    scoreOutlineWidth: 0,
    scoreOutlineBlur: 0,
    scoreOutlineOpacity: 0,
    scoreFontSize: 4,
    scoreFontWeight: 700,
    scoreSdfSize: 256,
    scoreX: 4.02,
    labelFill: '#d9665f',
    labelFillBoost: 1,
    labelGlow: '#d9665f',
    labelMuted: '#d9665f',
    labelMutedGlow: '#d9665f',
    labelFillOpacity: 1,
    labelOutlineWidth: 0.18,
    labelOutlineBlur: 0.5,
    labelOutlineOpacity: 0.72,
    labelFontSize: 0.32,
    labelFontWeight: 850,
    labelSdfSize: 128,
    labelPad: 0.3,
    labelYouLetterSpacing: 0.06,
    roomCodeFill: '#ffb38c',
    roomCodeFillBoost: 1.45,
    roomCodeGlow: '#d9665f',
    roomCodeFillOpacity: 1,
    roomCodeOutlineWidth: 1.4,
    roomCodeOutlineBlur: 1.2,
    roomCodeOutlineOpacity: 0.95,
    roomCodeFontSize: 0.74,
    roomCodeFontWeight: 850,
    roomCodeLetterSpacing: 0.12,
    roomCodeSdfSize: 192,
    roomCodePad: 0.68,
    dividerColor: '#fff9f0',
    dividerOpacity: 0.52,
    serveDotColor: '#d9665f',
    serveDotOpacity: 0.78,
    boardCY: 0.43,
    scoreZOffset: 0.045,
    popScale: 0.12,
    popLift: 0.08,
    breatheAmp: 0.004,
    breatheHeat: 0.012,
  },
};

export { BOTS, BOT_BY_ID, DEFAULT_DIFFICULTY, getBot };

export const PLAYER_PADDLE = { id: 'player', name: 'PLAYER', tag: 'Player', style: 0, colors: { core: '#d9665f', edge: '#c85f59', accent: '#ef8f87', soft: '#f3e7d2', handle: '#c98274', glowRGB: '217,102,95' }, stats: { power: 0.6, spin: 0.4, control: 0.6, speed: 0.6 }, play: { follow: 1, reach: 1, power: 1, spin: 1, control: 1 } };
export const CPU_PADDLE = { id: 'cpu', name: 'CPU', tag: 'CPU', style: 0, colors: { core: '#e3a085', edge: '#de7a6d', accent: '#f3c3ad', soft: '#ead9cb', handle: '#c98274', glowRGB: '222,122,109' }, stats: { power: 0.6, spin: 0.6, control: 0.6, speed: 0.6 }, play: { follow: 1, reach: 1, power: 1, spin: 1, control: 1 } };
