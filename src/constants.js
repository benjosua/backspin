// Recovered from production bundle /assets/index-DXcVVo4s.js.

export const TABLE = {
  halfLength: 4.75,       // $w
  halfWidth: 2.85,        // eT
  netHeight: 0.5,         // tT
  ballRadius: 0.12,       // nT
  bounceRestitution: 0.82,// rT
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
  bg: '#f2eadc',
  fog: '#f2eadc',
  floor: '#eee4d2',
  prop: '#f4ead8',
  table: '#1167b1',
  tableEmissive: '#1689e8',
  tableSide: '#0c4d86',
  tableLeg: '#e9ddc9',
  line: '#fbf6ec',
  net: '#fbf7ee',
  ball: '#ffe8a4',
  player: '#f0a23b',
  playerSoft: '#f6c074',
  ai: '#dd8a6f',
  aiSoft: '#e8ab93',
  ink: '#4b4034',
  inkSoft: '#b4a690',
};

export const TUNING = {
  world: { background: '#f2eadc', fog: '#f2eadc', fogDensity: 0.008 },
  table: {
    lineColor: '#f5fbff',
    emissive: '#1689e8',
    hot: '#31a7ff',
    baseGlow: 0.48,
    heatGlow: 0.58,
    flashGlow: 0.82,
    lineGlow: 1.2,
  },
  background: {
    ringColor: '#ff703d',
    ringInner: 6,
    ringWidth: 0.3,
    ringScaleX: 1.23,
    ringScaleZ: 1.41,
    ringY: 0.26,
    ringSegments: 124,
    ringOpacity: 0.8,
  },
  sky: { zenith: '#ddb9a3', edge: '#ffe9cf', horizon: 0.58 },
  lighting: { ambient: 1.84, ambColor: '#d15e00', key: 5, keyColor: '#ffffff' },
  post: {
    bloom: 0.55,
    bloomHeat: 0.12,
    bloomFlash: 0.22,
    luminanceThreshold: 0.96,
    luminanceSmoothing: 0.08,
    bloomRadius: 0.18,
    bloomLevels: 3,
  },
  net: { opacity: 1, color: '#fbf7ee' },
  ballTrail: { width: 4.2, length: 6, decay: 5, color: '#ffffff', attenuationPower: 3.2, local: false, stride: 0, interval: 1 },
  menu: { titleColor: '#fff3e0', titleBoost: 1.35, titleGlowColor: '#ff9100', titleGlow: 0.45, titleSize: 3.45, titleTracking: 0.56, titleY: 4.9, glassOpacity: 0.86, glassRim: 0.72, cardOpacity: 0.92 },
  scoreboard: {
    scoreFill: '#ffc0a1',
    scoreFillBoost: 1.95,
    scoreGlow: '#dea600',
    scoreFillOpacity: 1,
    scoreOutlineWidth: 3.5,
    scoreOutlineBlur: 1.5,
    scoreOutlineOpacity: 1,
    scoreFontSize: 4,
    scoreFontWeight: 700,
    scoreSdfSize: 512,
    scoreX: 4.02,
    labelFill: '#fff9f0',
    labelFillBoost: 1.8,
    labelGlow: '#ffd79c',
    labelMuted: '#efe3d2',
    labelMutedGlow: '#f5d3ad',
    labelFillOpacity: 1,
    labelOutlineWidth: 0,
    labelOutlineBlur: 0,
    labelOutlineOpacity: 1,
    labelFontSize: 0.32,
    labelFontWeight: 850,
    labelSdfSize: 128,
    labelPad: 0.3,
    labelYouLetterSpacing: 0.06,
    dividerColor: '#fff9f0',
    dividerOpacity: 0.52,
    serveDotColor: '#f0a23b',
    serveDotOpacity: 0.78,
    boardCY: 0.43,
    scoreZOffset: 0.045,
    popScale: 0.12,
    popLift: 0.08,
    breatheAmp: 0.004,
    breatheHeat: 0.012,
  },
};

export const BOTS = [
  { id: 'rookie', name: 'ROOKIE', tag: 'Still learning the table', minDepth: 0.58, skill: 0.28, paddleSpeed: 7.6, react: 4.6, reactionDelay: 0.21, serveReact: 0.11, servePredict: 0.36, predict: 0.17, error: 0.17, spin: 0.2, aggression: 0.14, placement: 0.22, smashChance: 0, wrongFoot: 0, catchup: 0.95, confSwing: 0.12, serveSpin: 0.22 },
  { id: 'pro', name: 'PRO', tag: 'Brings real heat', skill: 0.68, paddleSpeed: 12.4, react: 7.8, reactionDelay: 0.07, predict: 0.74, error: 0.055, spin: 0.68, aggression: 0.55, placement: 0.62, smashChance: 0.48, wrongFoot: 0.22, catchup: 0.42, confSwing: 0.2, serveSpin: 0.78 },
  { id: 'master', name: 'MASTER', tag: 'Do not blink', skill: 0.9, paddleSpeed: 15.5, react: 9.5, reactionDelay: 0, predict: 0.95, error: 0.025, spin: 0.95, aggression: 0.82, placement: 0.85, smashChance: 0.8, wrongFoot: 0.42, catchup: 0.08, confSwing: 0.26, serveSpin: 1 },
];

export const DEFAULT_DIFFICULTY = 'rookie';
export const BOT_BY_ID = Object.fromEntries(BOTS.map((bot) => [bot.id, bot]));
export const getBot = (id) => BOT_BY_ID[id] || BOT_BY_ID.rookie;

export const PADDLES = [
  { id: 'ember', name: 'BALANCED', tag: 'Reliable all-around play.', style: 0, colors: { core: '#f6c074', edge: '#f0a23b', accent: '#ffd98a', soft: '#f3e7d2', handle: '#df7a4f', glowRGB: '240,162,59' }, stats: { power: 0.6, spin: 0.4, control: 0.6, speed: 0.6 }, play: { follow: 1, reach: 1, power: 1, spin: 1, control: 1 } },
  { id: 'jade', name: 'SPIN', tag: 'More curve, less punch.', style: 2, colors: { core: '#a9cea6', edge: '#5f9d77', accent: '#d4ead0', soft: '#e2eade', handle: '#56806a', glowRGB: '120,180,130' }, stats: { power: 0.4, spin: 0.8, control: 0.4, speed: 0.4 }, play: { follow: 1, reach: 1.06, power: 0.85, spin: 1.3, control: 1.32 } },
  { id: 'volt', name: 'POWER', tag: 'Fast shots, harder control.', style: 1, colors: { core: '#9cc4cf', edge: '#5b97a6', accent: '#cfe6ea', soft: '#dfe9ea', handle: '#5a7e86', glowRGB: '120,175,190' }, stats: { power: 0.8, spin: 0.4, control: 0.4, speed: 0.4 }, play: { follow: 1.04, reach: 0.94, power: 1.2, spin: 0.82, control: 0.82 } },
  { id: 'zephyr', name: 'SPEED', tag: 'Quick to the ball, lighter touch.', style: 3, colors: { core: '#c2a6d6', edge: '#8e6fb0', accent: '#e6d6f0', soft: '#e7e0ee', handle: '#6a5a86', glowRGB: '160,130,195' }, stats: { power: 0.4, spin: 0.4, control: 0.4, speed: 0.8 }, play: { follow: 1.22, reach: 1.16, power: 0.92, spin: 1.06, control: 1 } },
];

export const DEFAULT_PADDLE = 'ember';
export const CPU_PADDLE = { id: 'house', name: 'HOUSE', tag: 'CPU', style: 0, colors: { core: '#e3a085', edge: '#dd8a6f', accent: '#f3c3ad', soft: '#ead9cb', handle: '#c07c66', glowRGB: '221,138,111' }, stats: { power: 0.6, spin: 0.6, control: 0.6, speed: 0.6 }, play: { follow: 1, reach: 1, power: 1, spin: 1, control: 1 } };
export const PADDLE_BY_ID = Object.fromEntries(PADDLES.map((paddle) => [paddle.id, paddle]));
export const getPaddle = (id) => PADDLE_BY_ID[id] || PADDLE_BY_ID.ember;
