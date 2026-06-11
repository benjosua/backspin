// Recovered gameplay engine from production bundle class `bO`.
// This file is intentionally imperative: original code mutates one engine object per frame.
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import {
  BOTS,
  CAMERA,
  COLORS,
  DEFAULT_DIFFICULTY,
  DEFAULT_PADDLE,
  getBot,
  getPaddle,
  PHYSICS,
  TABLE,
} from './constants.js';
import { DEBUG_MODE, debugFlags, randomSide, useGameStore } from './store.js';
import { arenaFx, clampDt, damp, decayFx, raiseFx, resetFx } from './fx-state.js';
import { initAudio, playBounce, playCharge, playHit, playMenu, playNet } from './audio.js';
import { predictBounceKick, resolvePlayerShot, solveSafeShot, solveShot } from '../shared/rally-core.js';

const clamp = MathUtils.clamp;
const rand = () => Math.random();
const browserNeedsPointerScale = (() => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const chromium = /Chrome|Chromium|Edg\//.test(ua);
  const firefox = /Firefox/.test(ua);
  return (/Apple/.test(navigator.vendor || '') && !chromium) || firefox;
})();
const pointerScale = () => (browserNeedsPointerScale && window.devicePixelRatio) || 1;
const winVolleyTimes = [0.12, 0.5, 0.95, 1.55, 2.3];

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
  rally: 0,
  callout: '',
  calloutT: 0,
  calloutColor: '',
  aiConfidence: 0.5,
  cursorVisible: false,
  cursorX: 0,
  cursorY: 0,
};

export function resetInputHud() {
  inputHud.charge = 0;
  inputHud.charging = false;
  inputHud.power = 0;
  inputHud.spinX = 0;
  inputHud.spinY = 0;
  inputHud.spinMag = 0;
  inputHud.spinLabel = '';
  inputHud.aimX = 0;
  inputHud.aimDepth = 0.5;
  inputHud.aimLabel = '';
  inputHud.rally = 0;
  inputHud.callout = '';
  inputHud.calloutT = 0;
  inputHud.cursorVisible = false;
}

export function makeBrain() {
  return { confidence: 0.5 };
}
export function resetBrain(brain) {
  brain.confidence = 0.5;
}
export function updateBrain(brain, aiWonPoint, pointQuality = 0.5) {
  const delta = (aiWonPoint ? 1 : -1) * (0.06 + pointQuality * 0.14);
  brain.confidence += delta + (0.5 - brain.confidence) * 0.06;
  brain.confidence = clamp(brain.confidence, 0.08, 0.96);
  return brain.confidence;
}
export function fatiguePenalty(rally) {
  return Math.min(0.28, Math.max(0, rally - 5) * 0.014);
}
export function effectiveSkill(bot, brain, aiScore, playerScore, rally = 0) {
  const confidenceBoost = (brain.confidence - 0.5) * bot.confSwing;
  const catchupPenalty = -bot.catchup * (aiScore - playerScore) * 0.03;
  return clamp(bot.skill + confidenceBoost + catchupPenalty - fatiguePenalty(rally), 0.2, 0.98);
}

function sideFromZ(z) {
  return z > 0 ? 'player' : 'ai';
}
function otherSide(side) {
  return side === 'player' ? 'ai' : 'player';
}

export class GameEngine {
  constructor() {
    this.ball = new Vector3(0, 1, 4.5);
    this.vel = new Vector3();
    this.spin = { top: 0, side: 0 };
    this.ballRotX = 0;
    this.ballRotY = 0;
    this.player = { who: 'player', x: 0, y: 0.62, z: 5, rotX: -0.22, rotZ: 0, vx: 0, prevX: 0, flash: 0, swing: 0, baseZ: 5 };
    this.ai = { who: 'ai', x: 0, y: 0.62, z: -5, rotX: 0.22, rotZ: 0, vx: 0, prevX: 0, flash: 0, swing: 0, baseZ: -5, tell: 0 };
    this.firstServer = randomSide();
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.rally = 0;
    this.pointTimer = 0;
    this.aiServeTimer = 0;
    this.shake = 0;
    this.overT = 0;
    this.volley = 0;
    this.paddle = getPaddle(DEFAULT_PADDLE);
    this.reach = PHYSICS.serveHeight;
    this.tier = getBot(DEFAULT_DIFFICULTY);
    this.brain = makeBrain();
    this.reactTimer = 0;
    this.tellSounded = false;
    this._lob = false;
    this._aiSmash = false;
    this.inputX = 0;
    this.aimX = 0;
    this.aimDepth = 0.5;
    this.ndcX = 0;
    this.ndcY = 0;
    this.pvx = 0;
    this.pvy = 0;
    this.lastT = 0;
    this.lastNdcX = 0;
    this.lastNdcY = 0;
    this.charging = false;
    this.charge = 0;
    this.chargeStartedAt = 0;
    this.kTop = 0;
    this.usingKeys = false;
    this.keys = { l: false, r: false };
    this.movePID = null;
    this.pointerLocked = false;
    this.shadow = { x: 0, z: 0, op: 0, scale: 0.5 };
    this.marker = { x: 0, z: 0, kickX: 0, kickZ: 0, op: 0, spin: 0, side: 0, smash: 0 };
    this.aim = { x: 0, z: 0, op: 0, spinX: 0, spinY: 0, power: 0 };
    this.netWobble = 0;
    this.netRotX = 0;

    const [x, y, z] = CAMERA.desktopPosition;
    const [lx, ly, lz] = CAMERA.desktopTarget;
    this.camX = x;
    this.camY = y;
    this.camZ = z;
    this.camLX = lx;
    this.camLY = ly;
    this.camLZ = lz;
    this.camFov = 44;
    this.swoop = 0;
    this.arriveT = 0;
    this.prevBallX = 0;
    this.prevBallY = 0;
    this.ray = new Raycaster();
    this.plane = new Plane(new Vector3(0, 1, 0), -0.62);
    this.ndc = new Vector2();
    this.hit = new Vector3();
    this.fx = null;
  }

  currentServer() {
    const { scoreP, scoreAI } = useGameStore.getState();
    const total = scoreP + scoreAI;
    const bucket = scoreP >= 10 && scoreAI >= 10 ? total : Math.floor(total / 2);
    if (bucket % 2 === 0) return this.firstServer;
    return this.firstServer === 'player' ? 'ai' : 'player';
  }

  newMatch() {
    this.firstServer = randomSide();
    this.player.x = 0;
    this.ai.x = 0;
    this.paddle = getPaddle(useGameStore.getState().paddle);
    this.reach = PHYSICS.serveHeight * this.paddle.play.reach;
    this.tier = getBot(useGameStore.getState().difficulty);
    resetBrain(this.brain);
    inputHud.aiConfidence = this.brain.confidence;
    resetFx();
    this.overT = 0;
    this.volley = 0;
    this.resetServe();
  }

  resetServe() {
    this.rally = 0;
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.vel.set(0, 0, 0);
    this.spin.top = 0;
    this.spin.side = 0;
    this.charge = 0;
    this.charging = false;
    this.chargeStartedAt = 0;
    this.reactTimer = 0;
    this.ai.tell = 0;
    this.tellSounded = false;
    resetInputHud();
    const server = this.currentServer();
    this.aiServeTimer = server === 'ai' ? 1.1 : 0;
    const store = useGameStore.getState();
    store.setServer(server);
    store.setPhase('serve');
  }

  setCallout(text, color = COLORS.ai) {
    inputHud.callout = text;
    inputHud.calloutColor = color;
    inputHud.calloutT = 0.9;
  }

  point(winner, reason) {
    const store = useGameStore.getState();
    if (store.phase !== 'rally' && store.phase !== 'serve') return;
    store.setPhase('point');
    this.pointTimer = 1;
    store.bumpScore(winner);
    const { scoreP, scoreAI } = useGameStore.getState();
    const ace = reason === 'WINNER' && this.rally === 0;
    const label = ace ? 'ACE' : reason;
    const color = winner === 'player' ? COLORS.player : COLORS.ai;
    this.fx?.burst?.(this.ball.x, this.ball.y, this.ball.z, color, ace ? 18 : 14, ace ? 6 : 5);
    this.fx?.shock?.(this.ball.x, this.ball.y, this.ball.z, color, 2.2);
    this.shake = ace ? 0.55 : 0.45;
    arenaFx.score = 1;
    raiseFx('pulse', 1);
    arenaFx.ix = this.ball.x;
    arenaFx.iz = this.ball.z;
    playMenu(winner === 'player');

    let quality = 0.45;
    if (ace) quality = 0.9;
    else if (reason === 'WINNER') quality = 0.75;
    else if (reason === 'NET' || reason === 'OUT' || reason === 'FAULT') quality = 0.3;
    updateBrain(this.brain, winner === 'ai', quality);
    inputHud.aiConfidence = this.brain.confidence;

    const deuce = scoreP >= 10 && scoreAI >= 10 && scoreP === scoreAI;
    store.flash(deuce ? 'DEUCE' : label, color);
    if (Math.max(scoreP, scoreAI) >= 11 && Math.abs(scoreP - scoreAI) >= 2) {
      store.setPhase('over');
      store.setWinner(winner);
      this.overT = 0;
      this.volley = 0;
      this.charging = false;
    }
  }

  serve() {
    const state = useGameStore.getState();
    if (state.started === false || state.phase !== 'serve') return;
    const server = this.currentServer();
    const isPlayer = server === 'player';
    const racket = isPlayer ? this.player : this.ai;
    const zDir = isPlayer ? -1 : 1;
    const play = this.paddle.play;
    const ball = this.ball;
    ball.set(racket.x, racket.y + PHYSICS.paddleThickness, racket.baseZ + zDir * 0.45);

    let topSpin, sideSpin, targetX, targetZ, flightTime;
    const charge = isPlayer ? this.charge : 0;
    if (isPlayer) {
      topSpin = clamp((this.pvy * CAMERA.cameraLookAhead + this.kTop) * play.spin, -0.8, 0.8);
      sideSpin = clamp(this.pvx * CAMERA.cameraZBase * play.spin, -0.8, 0.8);
      const aimX = this.aimX;
      const aimDepth = this.aimDepth;
      targetX = clamp(aimX * TABLE.halfWidth * 0.96 + sideSpin * TABLE.halfWidth * 0.22, -TABLE.halfWidth * 0.98, TABLE.halfWidth * 0.98);
      targetZ = zDir * (0.08 + aimDepth * 0.88) * TABLE.halfLength;
      flightTime = ((1 - charge * 0.25) * 0.72) / play.power;
    } else {
      const bot = this.tier;
      const skill = effectiveSkill(bot, this.brain, state.scoreAI, state.scoreP);
      const confidence = this.brain.confidence;
      const serveSpin = bot.serveSpin * (0.72 + skill * 0.28 + (confidence - 0.5) * bot.confSwing);
      topSpin = (rand() < 0.4 + bot.serveSpin * 0.45 ? 1 : -1) * (0.22 + rand() * 0.42) * serveSpin;
      sideSpin = (rand() - 0.5) * 1.55 * serveSpin;
      const awayFromPlayer = this.player.x >= 0 ? -1 : 1;
      const placement = bot.placement * 0.48 + bot.aggression * 0.32;
      targetX = clamp(
        awayFromPlayer * TABLE.halfWidth * (0.44 + placement * 0.4) + sideSpin * TABLE.halfWidth * 0.3 + (rand() - 0.5) * TABLE.halfWidth * Math.max(0.08, 0.28 - skill * 0.14),
        -TABLE.halfWidth * 0.92,
        TABLE.halfWidth * 0.92,
      );
      targetZ = zDir * (0.58 + rand() * (0.2 + skill * 0.22)) * TABLE.halfLength;
      if (bot.minDepth != null) targetZ = zDir * Math.max(Math.abs(targetZ / TABLE.halfLength), bot.minDepth) * TABLE.halfLength;
      flightTime = clamp(0.68 - bot.serveSpin * 0.14 - skill * 0.12, 0.46, 0.68);
    }
    this.spin.top = topSpin;
    this.spin.side = sideSpin;
    if (!isPlayer && this.tier.minDepth != null && topSpin < -0.15) topSpin = Math.max(topSpin, -0.22);
    this.vel.copy(isPlayer ? solveSafeShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin) : solveShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin));
    this.lastHitter = server;
    this.bouncedReceiver = false;
    this.charge = 0;
    if (server === 'player') this.reactTimer = this.tier.serveReact ?? this.tier.reactionDelay;
    useGameStore.getState().setPhase('rally');
    racket.swing = 1;
    playHit(charge, 0);
    raiseFx('pulse', 0.45 + charge * 0.4);
    arenaFx.ix = ball.x;
    arenaFx.iz = ball.z;
  }



  doHit(who) {
    const isPlayer = who === 'player';
    const racket = isPlayer ? this.player : this.ai;
    const zDir = isPlayer ? -1 : 1;
    const ball = this.ball;
    const reach = isPlayer ? this.reach : PHYSICS.serveHeight;
    const offset = clamp((ball.x - racket.x) / reach, -1, 1);
    const highBall = ball.y > PHYSICS.playerHeight;
    this.rally += 1;
    if ([8, 14, 20, 30].includes(this.rally)) this.setCallout(`RALLY ${this.rally}`, COLORS.ink);

    let flightTime = clamp(0.66 - this.rally * 0.013, 0.44, 0.66);
    let topSpin, sideSpin, targetX, targetZ;
    let error = 0;
    let power = 0;
    let playerShot = null;

    if (isPlayer) {
      const play = this.paddle.play;
      power = this.charge;
      const flickX = Math.abs(this.pvx) > 0.9 ? this.pvx : this.pvx * 0.25;
      const flickY = Math.abs(this.pvy) > 0.9 ? this.pvy : this.pvy * 0.25;
      const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
      const chargeHeldMs = this.chargeStartedAt ? Math.max(0, (now - this.chargeStartedAt) * 1000) : power * 500;
      playerShot = resolvePlayerShot(
        {
          side: 'player',
          ball: { x: ball.x, y: ball.y, z: ball.z },
          incomingVelocity: { x: this.vel.x, y: this.vel.y, z: this.vel.z },
          offset,
          rally: this.rally,
        },
        {
          charge: power,
          chargeHeldMs,
          charging: this.charging,
          swipeX: flickX,
          swipeY: flickY + this.kTop / CAMERA.cameraLookAhead,
          paddleVx: this.player.vx,
          aimX: this.aimX,
          aimDepth: this.aimDepth,
        },
        {
          spinScale: play.spin,
          powerScale: play.power,
          controlScale: play.control,
          swipeTopScale: CAMERA.cameraLookAhead,
          swipeSideScale: CAMERA.cameraZBase,
          paddleSideScale: 0.5 / 9,
          random: rand,
        },
      );
      topSpin = playerShot.spin.top;
      sideSpin = playerShot.spin.side;
      targetX = playerShot.target.x;
      targetZ = playerShot.target.z;
      flightTime = playerShot.flightTime;
    } else {
      const bot = this.tier;
      const { scoreAI, scoreP } = useGameStore.getState();
      const fatigue = fatiguePenalty(this.rally);
      const skill = effectiveSkill(bot, this.brain, scoreAI, scoreP, this.rally);
      const confidence = this.brain.confidence;
      const playerX = this.player.x;
      const incomingSpeed = Math.hypot(this.vel.x, this.vel.z);
      const softBall = !highBall && incomingSpeed < 6.2 && ball.y > 0.42;
      this._aiSmash = (highBall || softBall) && rand() < bot.smashChance * (0.55 + confidence * 0.7) * (1 - fatigue * 0.55);
      const playerHeat = this.lastHitter === 'player' && incomingSpeed >= 7.8;
      const lobChance = bot.minDepth == null ? (1 - bot.aggression) * 0.28 : bot.aggression * 0.22 + bot.spin * 0.04;
      this._lob = playerHeat && !this._aiSmash && !highBall && rand() < lobChance;

      if (this._lob) {
        topSpin = -(0.12 + rand() * 0.22);
        sideSpin = (rand() - 0.5) * 0.8 * bot.spin;
      } else {
        topSpin = rand() < 0.1 + bot.spin * 0.12
          ? -(0.25 + rand() * 0.45) * (0.6 + bot.spin)
          : (0.2 + rand() * 0.6) * (0.4 + bot.spin) * skill;
        sideSpin = (rand() - 0.5) * 1.7 * bot.spin * (0.7 + confidence * 0.5);
      }

      if (Math.abs(this.player.vx) > 3 && rand() < bot.wrongFoot * confidence) {
        targetX = clamp(((-Math.sign(this.player.vx) || 1) * TABLE.halfWidth * (0.45 + bot.aggression * 0.4)) + (rand() - 0.5) * TABLE.halfWidth * 0.3, -TABLE.halfWidth * 0.9, TABLE.halfWidth * 0.9);
      } else {
        const away = playerX >= 0 ? -1 : 1;
        targetX = clamp(-playerX * (0.3 + bot.placement * 0.4) + away * bot.aggression * TABLE.halfWidth * 0.45 + (rand() - 0.5) * TABLE.halfWidth * (1 - bot.aggression), -TABLE.halfWidth * 0.9, TABLE.halfWidth * 0.9);
      }
      error = bot.error * (1.25 - confidence * 0.5) + fatigue * 0.08;
    }

    const smash = isPlayer ? playerShot?.smash : this._aiSmash;
    if (isPlayer && smash) power = Math.max(power, 0.85);
    if (!isPlayer && smash) {
      topSpin = Math.max(topSpin, 0.2);
      flightTime = PHYSICS.spinDecay;
      targetZ = zDir * (0.72 + rand() * 0.2) * TABLE.halfLength;
      power = Math.max(power, 0.85);
    } else if (!isPlayer) {
      if (topSpin > 0) {
        flightTime *= 1 - topSpin * 0.24;
        targetZ = zDir * (0.58 + rand() * 0.32) * TABLE.halfLength;
      } else if (topSpin < -0.15) {
        flightTime *= 1 + Math.abs(topSpin) * 0.32;
        targetZ = zDir * (0.34 + rand() * 0.22) * TABLE.halfLength;
      } else {
        targetZ = zDir * (0.5 + rand() * 0.35) * TABLE.halfLength;
      }
      if (!isPlayer && this._lob) {
        flightTime = 0.92 + rand() * 0.16;
        targetZ = zDir * (0.5 + rand() * 0.16) * TABLE.halfLength;
      }
    }

    if (!isPlayer && this.tier.minDepth != null) {
      targetZ = zDir * Math.max(Math.abs(targetZ / TABLE.halfLength), this.tier.minDepth) * TABLE.halfLength;
      if (topSpin < -0.15) topSpin = Math.max(topSpin, -0.22);
    }

    this.spin.top = topSpin;
    this.spin.side = sideSpin;
    const solved = isPlayer
      ? new Vector3(playerShot.velocity.x, playerShot.velocity.y, playerShot.velocity.z)
      : solveShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin);
    if (error > 0) {
      solved.x *= 1 + (rand() - 0.5) * 2 * error;
      solved.y *= 1 + (rand() - 0.5) * 2 * error;
      solved.z *= 1 + (rand() - 0.5) * 2 * error * 0.7;
    }
    this.vel.copy(solved);
    this.lastHitter = who;
    this.bouncedReceiver = false;
    racket.flash = 1;
    racket.swing = 1;
    const color = isPlayer ? COLORS.player : COLORS.ai;
    this.fx?.burst?.(ball.x, ball.y, ball.z, color, smash ? 18 : 6 + Math.round(power * 6), smash ? 6.5 : 3.5 + power * 2.5);
    this.fx?.impact?.(ball.x, ball.y, ball.z, color, smash ? 1 : 0.4 + power * 0.6);
    if (smash || power > 0.6) this.fx?.shock?.(ball.x, ball.y, ball.z, color, smash ? 2.8 : 1.6);
    this.shake = (smash ? 0.55 : 0.18) + power * 0.28;
    playHit(smash ? 1 : power, this.rally);
    arenaFx.ix = ball.x;
    arenaFx.iz = ball.z;
    raiseFx('pulse', isPlayer ? 0.55 + power * 0.45 : 0.5);
    if (smash) raiseFx('smash', 1);
    else if (power > 0.6) raiseFx('smash', 0.6 + power * 0.3);
    if (smash) this.setCallout('SMASH', color);
    else if (isPlayer && playerShot?.intent === 'counter') this.setCallout('COUNTER', color);
    else if (isPlayer && playerShot?.intent === 'lob') this.setCallout('LOB', color);
    else if (isPlayer && playerShot?.intent === 'block') this.setCallout('BLOCK', color);
    else if (isPlayer && power > 0.72) this.setCallout('POWER', color);

    if (isPlayer) {
      this.charge = 0;
      inputHud.power = power;
      inputHud.spinX = sideSpin;
      inputHud.spinY = topSpin;
      inputHud.spinMag = Math.min(1, Math.hypot(sideSpin, topSpin));
      inputHud.spinLabel = playerShot?.intent === 'lob' ? 'LOB' : playerShot?.intent === 'block' ? 'BLOCK' : Math.abs(sideSpin) > 0.35 ? 'SIDESPIN' : topSpin > 0.3 ? 'TOPSPIN' : topSpin < -0.2 ? 'CHOP' : '';
      this.reactTimer = this.tier.reactionDelay;
    } else {
      this.ai.tell = 0;
      this.tellSounded = false;
    }
  }

  updateAI(dt, phase) {
    const bot = this.tier;
    const ai = this.ai;
    const ball = this.ball;
    if (this.reactTimer > 0) this.reactTimer -= dt;
    const fatigue = fatiguePenalty(this.rally);
    const firstReturn = this.rally === 0 && phase === 'rally' && this.lastHitter === 'player';
    let predict = bot.predict * (1 - fatigue * 1.15);
    if (firstReturn && bot.servePredict != null) predict = Math.max(predict, bot.servePredict);
    const maxSpeed = bot.paddleSpeed * (1 - fatigue * 0.32);
    const react = bot.react * (1 - fatigue * 0.22);
    let target = 0;
    const incoming = phase === 'rally' && this.lastHitter === 'player';
    if (incoming && this.reactTimer <= 0) {
      const time = this.vel.z < -0.1 ? clamp((-4.8 - ball.z) / this.vel.z, 0, 1.2) : 0.4;
      const predicted = ball.x + this.vel.x * time + this.spin.side * 0.5 * PHYSICS.magnus * time * time;
      target = clamp(MathUtils.lerp(ball.x, predicted, predict), -TABLE.halfWidth - 0.4, TABLE.halfWidth + 0.4);
    } else if (incoming) {
      target = ai.x * 0.7;
    }
    const desiredVx = clamp((target - ai.x) * 7, -maxSpeed, maxSpeed);
    ai.vx = damp(ai.vx, desiredVx, react, dt);
    ai.x = clamp(ai.x + ai.vx * dt, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
  }

  handleBounce() {
    const ball = this.ball;
    if (!(Math.abs(ball.x) <= 2.97) || !(Math.abs(ball.z) <= 4.87)) return false;
    const side = sideFromZ(ball.z);
    ball.y = TABLE.ballRadius;
    this.vel.y = Math.abs(this.vel.y) * TABLE.bounceRestitution * (1 - Math.max(this.spin.top, 0) * 0.18);
    const zSign = Math.sign(this.vel.z) || 1;
    this.vel.z += zSign * this.spin.top * PHYSICS.speedScale;
    this.vel.x += this.spin.side * PHYSICS.curveScale;
    this.spin.top *= 0.55;
    this.spin.side *= 0.55;
    this.fx?.ring?.(ball.x, ball.z);
    raiseFx('bounce', 1);
    raiseFx('pulse', 0.4);
    arenaFx.ix = ball.x;
    arenaFx.iz = ball.z;
    playBounce();
    if (this.lastHitter && side === this.lastHitter) this.point(otherSide(this.lastHitter), 'FAULT');
    else if (this.bouncedReceiver) this.point(this.lastHitter, 'WINNER');
    else this.bouncedReceiver = true;
    return true;
  }

  handleNet(prevZ) {
    const ball = this.ball;
    if (Math.sign(prevZ) === Math.sign(ball.z)) return false;
    const crossT = (0 - prevZ) / (ball.z - prevZ || 0.000001);
    if (MathUtils.lerp(this.prevBallY, ball.y, crossT) - 0.048 > TABLE.netHeight) return false;
    ball.z = Math.sign(prevZ) * 0.06;
    this.vel.z *= -0.12;
    this.vel.x *= 0.4;
    this.vel.y = Math.min(this.vel.y, 1.5);
    this.netWobble = 1;
    raiseFx('pulse', 0.8);
    raiseFx('bounce', 0.5);
    arenaFx.ix = ball.x;
    arenaFx.iz = ball.z;
    playNet();
    this.point(otherSide(this.lastHitter), 'NET');
    return true;
  }

  checkRacketHit(who, prevZ) {
    if (this.lastHitter === who || !this.bouncedReceiver) return;
    const racketZ = who === 'player' ? PHYSICS.gravity : -PHYSICS.gravity;
    if (!(who === 'player' ? this.vel.z > 0 : this.vel.z < 0)) return;
    const ball = this.ball;
    if ((prevZ - racketZ) * (ball.z - racketZ) > 0) return;
    const racket = who === 'player' ? this.player : this.ai;
    const t = (racketZ - prevZ) / (ball.z - prevZ || 0.000001);
    const x = MathUtils.lerp(this.prevBallX, ball.x, t);
    const y = MathUtils.lerp(this.prevBallY, ball.y, t);
    const reach = who === 'player' ? this.reach : PHYSICS.serveHeight;
    if (!(Math.abs(x - racket.x) > reach) && !(y < 0.05) && !(who === 'player' ? y > 3.4 : Math.abs(y - racket.y) > 1)) {
      ball.set(x, y, racketZ);
      this.doHit(who);
    }
  }

  syncCursorScreen() {
    inputHud.cursorX = (this.ndcX + 1) * 0.5 * window.innerWidth;
    inputHud.cursorY = (1 - this.ndcY) * 0.5 * window.innerHeight;
  }
  setPointerLocked(locked) { this.pointerLocked = locked; if (locked) this.syncCursorScreen(); }

  onPointerMove(event) {
    if (event.pointerType !== 'mouse' && event.pointerId !== this.movePID) return;
    let x, y;
    if (this.pointerLocked) {
      const scale = pointerScale();
      x = clamp(this.ndcX + (event.movementX * scale / window.innerWidth) * 2, -1, 1);
      y = clamp(this.ndcY - (event.movementY * scale / window.innerHeight) * 2, -1, 1);
    } else {
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = -(event.clientY / window.innerHeight) * 2 + 1;
    }
    const seconds = event.timeStamp / 1000;
    const dt = seconds - this.lastT;
    if (dt > 0 && dt < 0.1) {
      this.pvx = this.pvx * 0.4 + ((x - this.lastNdcX) / dt) * 0.6;
      this.pvy = this.pvy * 0.4 + ((y - this.lastNdcY) / dt) * 0.6;
    }
    this.lastT = seconds;
    this.lastNdcX = x;
    this.lastNdcY = y;
    this.ndcX = x;
    this.ndcY = y;
    this.syncCursorScreen();
    this.usingKeys = false;
  }

  onPointerDown(event) {
    if (event.pointerType !== 'mouse' || event.button === 0) {
      initAudio();
      if (event.pointerType !== 'mouse') {
        if (this.movePID !== null) return;
        this.movePID = event.pointerId;
        this.lastT = -1;
      }
      this.onPointerMove(event);
      if (!this.charging) this.chargeStartedAt = event.timeStamp / 1000;
      this.charging = true;
    }
  }
  onPointerUp(event) {
    if (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.pointerType !== 'mouse') {
        if (event.pointerId !== this.movePID) return;
        this.movePID = null;
      }
    }
    const state = useGameStore.getState();
    if (state.phase === 'serve' && state.server === 'player') this.serve();
    this.charging = false;
  }
  onKeyDown(event) {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') { this.keys.l = true; this.usingKeys = true; }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') { this.keys.r = true; this.usingKeys = true; }
    if (event.code === 'ArrowUp' || event.code === 'KeyW') this.kTop = 0.85;
    if (event.code === 'ArrowDown' || event.code === 'KeyS') this.kTop = -0.7;
    if (event.code === 'Space' || event.code === 'Enter') {
      initAudio();
      if (!this.charging) this.chargeStartedAt = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
      this.charging = true;
      event.preventDefault();
    }
  }
  onKeyUp(event) {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.keys.l = false;
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.keys.r = false;
    if (event.code === 'Space' || event.code === 'Enter') {
      const state = useGameStore.getState();
      if (state.phase === 'serve' && state.server === 'player') this.serve();
      this.charging = false;
    }
  }

  update(dt, time, camera, effects) {
    this.fx = effects;
    dt = clampDt(dt);
    const state = useGameStore.getState();
    if (debugFlags.forceOver) {
      const forced = debugFlags.forceOver;
      const winner = typeof forced === 'object' ? forced.winner : forced;
      this.overT = 0;
      this.volley = 0;
      if (winner === 'player' || winner === 'ai') {
        state.setPhase('over');
        state.setWinner(winner);
      }
      debugFlags.forceOver = null;
    }
    if (!state.started) {
      this.idle(dt, time, camera);
      return;
    }
    if (state.menuOpen && state.phase !== 'over') {
      this.pauseFrame(dt);
      return;
    }

    const phase = state.phase;
    const server = state.server;
    const player = this.player;
    const ai = this.ai;
    const ball = this.ball;

    if (inputHud.calloutT > 0) {
      inputHud.calloutT -= dt;
      if (inputHud.calloutT <= 0) inputHud.callout = '';
    }

    const rallying = phase === 'rally';
    arenaFx.heat = damp(arenaFx.heat, rallying ? clamp(0.16 + this.rally * 0.07, 0, 1) : 0, rallying ? 2.6 : 1, dt);
    decayFx(dt);
    arenaFx.serveCharge = this.charge;
    arenaFx.rallyN = this.rally;

    this.pvx = damp(this.pvx, 0, 9, dt);
    this.pvy = damp(this.pvy, 0, 9, dt);
    this.kTop = damp(this.kTop, 0, 6, dt);

    player.prevX = player.x;
    if (this.usingKeys) {
      const dir = Number(!!this.keys.r) - Number(!!this.keys.l);
      this.inputX = clamp(this.inputX + dir * 10 * dt, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
    } else if (camera) {
      this.ndc.set(this.ndcX, this.ndcY);
      this.ray.setFromCamera(this.ndc, camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.inputX = clamp(this.hit.x, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);
      }
    }

    this.aimX = clamp(this.inputX / (TABLE.halfWidth + 0.5), -1, 1);
    this.aimDepth = clamp((this.ndcY + this.kTop * 0.7 + 1) * 0.5, 0, 1);

    player.x = damp(player.x, this.inputX, this.paddle.play.follow * 16, dt);
    player.vx = (player.x - player.prevX) / Math.max(dt, 0.000001);
    this.updateAI(dt, phase);

    const aiCanSmashTell = phase === 'rally' && this.lastHitter === 'player' && this.bouncedReceiver && this.tier.smashChance > 0.25 && ball.z < -2.4 && this.vel.z < 0 && ball.y > 0.68;
    ai.tell = damp(ai.tell, Number(!!aiCanSmashTell), aiCanSmashTell ? 10 : 8, dt);
    if (aiCanSmashTell && !this.tellSounded && ai.tell > 0.4) {
      playCharge(0.85);
      this.tellSounded = true;
    }
    if (!aiCanSmashTell) this.tellSounded = false;

    const canCharge = phase === 'rally' || (phase === 'serve' && server === 'player');
    if (this.charging && canCharge) {
      const old = this.charge;
      this.charge = Math.min(1, this.charge + dt / PHYSICS.hitReach);
      if (Math.floor(old * 4) !== Math.floor(this.charge * 4)) playCharge(this.charge);
    } else {
      this.charge = Math.max(0, this.charge - PHYSICS.playerReach * dt);
    }
    inputHud.charge = this.charge;
    inputHud.charging = this.charging && canCharge;
    inputHud.rally = this.rally;
    inputHud.aimX = this.aimX;
    inputHud.aimDepth = this.aimDepth;
    inputHud.aimLabel = `${this.aimX < -0.25 ? 'LEFT' : this.aimX > 0.25 ? 'RIGHT' : 'CENTER'} · ${this.aimDepth < 0.35 ? 'SHORT' : this.aimDepth > 0.7 ? 'DEEP' : 'MID'}`;
    if (inputHud.charging) {
      inputHud.spinX = clamp(this.pvx * 0.12, -1, 1);
      inputHud.spinY = clamp((this.pvy + this.kTop) * 0.12, -1, 1);
      inputHud.spinMag = Math.min(1, Math.hypot(inputHud.spinX, inputHud.spinY));
      inputHud.spinLabel = Math.abs(inputHud.spinX) > 0.35 ? 'SIDESPIN' : inputHud.spinY > 0.3 ? 'TOPSPIN' : inputHud.spinY < -0.2 ? 'CHOP' : '';
    } else if (inputHud.spinMag > 0) inputHud.spinMag = Math.max(0, inputHud.spinMag - dt * 1.2);

    for (const racket of [player, ai]) {
      const who = racket.who;
      const incoming = phase === 'rally' && this.lastHitter !== who && this.lastHitter !== null;
      const yLimit = who === 'player' ? 2.6 : 1.6;
      const targetY = incoming ? clamp(ball.y, 0.4, yLimit) : 0.62 + Math.sin(time * 2 + (who === 'ai' ? 2 : 0)) * 0.07;
      racket.y = damp(racket.y, targetY, 8, dt);
      racket.swing = Math.max(0, racket.swing - dt * 4.5);
      racket.flash = Math.max(0, racket.flash - dt * 4);
      const sign = who === 'player' ? 1 : -1;
      racket.z = racket.baseZ - sign * racket.swing * 0.5;
      racket.rotX = (who === 'player' ? -0.22 : 0.22) - sign * racket.swing * 0.7 + Math.sin(time * 1.5) * 0.03;
      racket.rotZ = damp(racket.rotZ, -racket.vx * 0.018, 12, dt);
    }

    if (phase === 'serve') {
      const racket = server === 'player' ? player : ai;
      const zDir = server === 'player' ? -1 : 1;
      ball.x = damp(ball.x, racket.x, 12, dt);
      ball.z = racket.baseZ + zDir * 0.5;
      ball.y = racket.y + PHYSICS.paddleThickness + Math.sin(time * 4) * 0.05;
      if (server === 'ai') {
        if (this.swoop >= 1) this.aiServeTimer -= dt;
        if (this.aiServeTimer <= 0) this.serve();
      }
    } else if (phase === 'rally' || phase === 'point') {
      this.prevBallX = ball.x;
      this.prevBallY = ball.y;
      const prevZ = ball.z;
      this.vel.x += this.spin.side * PHYSICS.magnus * dt;
      this.vel.y -= (30 + this.spin.top * 11) * dt;
      ball.x += this.vel.x * dt;
      ball.y += this.vel.y * dt;
      ball.z += this.vel.z * dt;
      if (phase === 'rally') {
        if (!this.handleNet(prevZ)) {
          this.checkRacketHit('player', prevZ);
          this.checkRacketHit('ai', prevZ);
        }
        if (this.vel.y < 0 && ball.y <= TABLE.ballRadius && !this.handleBounce() && ball.y < -1.2) {
          this.point(this.bouncedReceiver ? this.lastHitter : otherSide(this.lastHitter), this.bouncedReceiver ? 'WINNER' : 'OUT');
        }
        if (Math.abs(ball.z) > 7.95 || Math.abs(ball.x) > 6.05 || ball.y < -1.6) {
          this.point(this.bouncedReceiver ? this.lastHitter : otherSide(this.lastHitter), this.bouncedReceiver ? 'WINNER' : 'OUT');
        }
      } else {
        if (ball.y <= TABLE.ballRadius && this.vel.y < 0 && Math.abs(ball.x) <= TABLE.halfWidth && Math.abs(ball.z) <= TABLE.halfLength) {
          ball.y = TABLE.ballRadius;
          this.vel.y = Math.abs(this.vel.y) * 0.5;
          this.vel.x *= 0.9;
          this.vel.z *= 0.9;
        }
        this.pointTimer -= dt;
        if (this.pointTimer <= 0 && useGameStore.getState().phase === 'point') this.resetServe();
      }
    }

    this.ballRotX -= (2 + this.spin.top * 16) * dt;
    this.ballRotY += this.spin.side * 14 * dt;
    const tableish = Math.abs(ball.x) < 3.25 && Math.abs(ball.z) < 5.15;
    this.shadow.x = ball.x;
    this.shadow.z = ball.z;
    this.shadow.op = tableish ? clamp(0.45 - ball.y * 0.09, 0.1, 0.45) : 0;
    this.shadow.scale = 0.5 + ball.y * 0.16;
    const aiming = phase === 'rally' || (phase === 'serve' && server === 'player');
    this.aim.x = this.aimX * TABLE.halfWidth * 0.96;
    this.aim.z = -(0.08 + this.aimDepth * 0.88) * TABLE.halfLength;
    this.aim.op = aiming ? clamp(0.12 + this.charge * 0.6, 0, 0.78) : 0;
    this.aim.spinX = clamp(this.pvx * 0.12, -1, 1);
    this.aim.spinY = clamp((this.pvy + this.kTop) * 0.12, -1, 1);
    this.aim.power = this.charge;

    if (phase === 'rally' && this.lastHitter === 'ai' && !this.bouncedReceiver) {
      this.marker.op = 0;
      this.marker.spin = 0;
      this.marker.smash = 0;
      const prediction = predictBounceKick(ball, this.vel, this.spin);
      if (prediction) {
        this.marker.x = prediction.x;
        this.marker.z = prediction.z;
        this.marker.kickX = prediction.kickX;
        this.marker.kickZ = prediction.kickZ;
        this.marker.spin = prediction.spin;
        this.marker.side = prediction.side;
        this.marker.smash = prediction.smash;
        this.marker.op = Math.abs(this.marker.x) < TABLE.halfWidth && Math.abs(this.marker.z) < TABLE.halfLength ? 0.32 + Math.sin(time * 10) * 0.08 : 0;
      }
    } else {
      this.marker.op = 0;
      this.marker.spin = 0;
      this.marker.smash = 0;
    }

    this.netWobble = Math.max(0, this.netWobble - dt * 2.2);
    this.netRotX = Math.sin(time * 26) * this.netWobble * 0.1;

    let overY = 0, overZ = 0, lookYOffset = 0;
    if (phase === 'over') {
      this.overT += dt;
      const playerWon = state.winner === 'player';
      if (playerWon && this.fx) {
        while (this.volley < winVolleyTimes.length && this.overT >= winVolleyTimes[this.volley]) {
          const x = (rand() - 0.5) * TABLE.halfWidth * 2.2;
          const z = (rand() - 0.5) * TABLE.halfLength * 1.1;
          this.fx.confetti?.(x, 2.4 + rand() * 0.8, z, this.volley === 0 ? 70 : 44, 2.8);
          raiseFx('score', 1);
          if (this.volley === 0) {
            this.fx.shock?.(0, TABLE.netHeight + 0.6, 0, COLORS.player, 3.2);
            this.shake = Math.max(this.shake, 0.4);
          }
          this.volley += 1;
        }
      }
      const t = clamp(this.overT / 1.8, 0, 1);
      const eased = t * t * (3 - t * 2);
      if (playerWon) { overY = eased * 0.55; overZ = eased * -1.1; }
      else { overY = eased * -0.38; overZ = eased * 0.85; lookYOffset = eased * -0.3; }
    }

    this.shake = Math.max(0, this.shake - dt * 1.8);
    const shake2 = this.shake * this.shake;
    const heat = arenaFx.heat;
    const heatScale = 1 + heat * 0.5;
    const bob = Math.sin(time * (1 + heat)) * (0.03 + heat * 0.07);
    this.swoop = Math.min(1, this.swoop + dt / CAMERA.menuDolly);
    const s = this.swoop;
    const cameraBlend = CAMERA.cameraLag + (1 - CAMERA.cameraLag) * (s * s * (3 - s * 2));
    this.camX = damp(this.camX, CAMERA.introPosition[0] + this.ndcX * 0.7 * heatScale + (rand() - 0.5) * shake2 * 0.6, cameraBlend * 3, dt);
    this.camY = damp(this.camY, CAMERA.introPosition[1] + this.ndcY * 0.35 + bob + (rand() - 0.5) * shake2 * 0.6 + overY, cameraBlend * 3, dt);
    this.camZ = damp(this.camZ, CAMERA.introPosition[2] - heat * 1.4 - arenaFx.smash * 0.6 + overZ, cameraBlend * 3.4, dt);
    this.camLX = damp(this.camLX, CAMERA.introTarget[0], cameraBlend * 2.6, dt);
    this.camLY = damp(this.camLY, CAMERA.introTarget[1] + lookYOffset, cameraBlend * 2.6, dt);
    this.camLZ = damp(this.camLZ, CAMERA.introTarget[2], cameraBlend * 2.6, dt);
    this.camFov = damp(this.camFov, 38, cameraBlend * 2.8, dt);
  }

  pauseFrame(dt) {
    decayFx(dt);
    arenaFx.heat = damp(arenaFx.heat, 0, 1.4, dt);
    inputHud.charging = false;
  }

  idle(dt, time, camera) {
    const player = this.player;
    const ai = this.ai;
    const ball = this.ball;
    this.swoop = 0;
    arenaFx.heat = damp(arenaFx.heat, 0, 1, dt);
    decayFx(dt);
    arenaFx.serveCharge = 0;
    arenaFx.rallyN = 0;

    if (camera) {
      this.ndc.set(this.ndcX, this.ndcY);
      this.ray.setFromCamera(this.ndc, camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.inputX = clamp(this.hit.x * 0.6, -TABLE.halfWidth * 0.7, TABLE.halfWidth * 0.7);
      }
    }
    player.x = damp(player.x, this.inputX, 6, dt);
    player.vx = 0;
    for (const racket of [player, ai]) {
      const sign = racket.who === 'player' ? 1 : -1;
      racket.y = damp(racket.y, 0.62 + Math.sin(time * 1.6 + (racket.who === 'ai' ? 2 : 0)) * 0.06, 6, dt);
      racket.z = racket.baseZ;
      racket.swing = Math.max(0, racket.swing - dt * 4.5);
      racket.flash = Math.max(0, racket.flash - dt * 4);
      racket.rotX = (racket.who === 'player' ? -0.22 : 0.22) + Math.sin(time * 1.2 + sign) * 0.04;
      racket.rotZ = damp(racket.rotZ, 0, 8, dt);
    }
    ball.x = damp(ball.x, 0, 3, dt);
    ball.z = damp(ball.z, 0, 3, dt);
    ball.y = damp(ball.y, 0.34 + Math.sin(time * 1.5) * 0.04, 3, dt);
    this.ballRotY += dt * 0.6;
    this.shadow.x = ball.x;
    this.shadow.z = ball.z;
    this.shadow.op = clamp(0.4 - ball.y * 0.1, 0.12, 0.4);
    this.shadow.scale = 0.5 + ball.y * 0.16;
    this.marker.op = 0;
    this.netWobble = Math.max(0, this.netWobble - dt * 2.2);
    this.netRotX = Math.sin(time * 26) * this.netWobble * 0.1;

    let camPos = DEBUG_MODE ? CAMERA.introPosition : CAMERA.playPosition;
    let camTarget = DEBUG_MODE ? CAMERA.introTarget : CAMERA.playTarget;
    let fov = DEBUG_MODE ? 38 : 50;
    let blend = 1;
    const store = useGameStore.getState();
    if (!DEBUG_MODE) {
      if (!store.revealed) {
        camPos = CAMERA.desktopPosition;
        camTarget = CAMERA.desktopTarget;
        fov = 44;
        this.arriveT = 0;
      } else if (this.arriveT < 3.5) {
        this.arriveT += dt;
        const t = clamp((this.arriveT - CAMERA.mobileScale) / CAMERA.cameraXInfluence, 0, 1);
        blend = CAMERA.cameraYOffset + (1 - CAMERA.cameraYOffset) * (t * t * (3 - t * 2));
      }
    }
    const bob = Math.sin(time * 0.8) * 0.05;
    this.camX = damp(this.camX, camPos[0] + this.ndcX * 0.35, blend * 2.4, dt);
    this.camY = damp(this.camY, camPos[1] + bob * 0.7, blend * 2.4, dt);
    this.camZ = damp(this.camZ, camPos[2], blend * 2.4, dt);
    this.camLX = damp(this.camLX, camTarget[0] + this.ndcX * 0.5, blend * 2.4, dt);
    this.camLY = damp(this.camLY, camTarget[1] + this.ndcY * 0.2, blend * 2.4, dt);
    this.camLZ = damp(this.camLZ, camTarget[2], blend * 2.4, dt);
    this.camFov = damp(this.camFov, fov, blend * 2.4, dt);
  }

}

export const game = new GameEngine();
