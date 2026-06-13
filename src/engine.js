// Recovered gameplay engine from production bundle class `bO`.
// This file is intentionally imperative: original code mutates one engine object per frame.
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import {
  BOTS,
  CAMERA,
  COLORS,
  DEFAULT_DIFFICULTY,
  getBot,
  PHYSICS,
  PLAYER_PADDLE,
  TABLE,
} from './constants.js';
import { DEBUG_MODE, debugFlags, randomSide, useGameStore } from './store.js';
import { arenaFx, clampDt, damp, decayFx, raiseFx, resetFx } from './fx-state.js';
import { initAudio, playBounce, playCharge, playHit, playMenu, playNet } from './audio.js';
import { predictBounceKick, resolvePlayerShot, simulateReceiverContact, solveLegalServe, solveReachableShot } from '../shared/backspin-core.js';
import { otherSide as sharedOtherSide, currentServer as sharedCurrentServer, pointQuality as sharedPointQuality, resolveBouncePoint, resolveOutPoint } from '../shared/backspin-rules.js';
import { applyBounce, detectNet, detectRacketContact, stepBall } from '../shared/backspin-physics.js';
import { makeAim, makeMarker, makeRacket, makeShadow, updateShadow, resetMarker } from '../shared/backspin-view-model.js';
import {
  makeBrain as makeSharedBrain,
  resetBrain as resetSharedBrain,
  updateBrain as updateSharedBrain,
  fatiguePenalty as sharedFatiguePenalty,
  effectiveSkill as sharedEffectiveSkill,
  resolveBotServe,
  resolveBotReturn,
  resolveBotPaddleTarget,
  stepBotPaddle,
} from '../shared/backspin-bot.js';

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
const ATTRACT_BOT_ID = 'master';
const ATTRACT_RESET_DELAY = 1.35;


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
  inputHud.exchange = 0;
  inputHud.callout = '';
  inputHud.calloutT = 0;
  inputHud.cursorVisible = false;
}

export function makeBrain() {
  return makeSharedBrain();
}
export function resetBrain(brain) {
  return resetSharedBrain(brain);
}
export function updateBrain(brain, aiWonPoint, pointQuality = 0.5) {
  return updateSharedBrain(brain, aiWonPoint, pointQuality);
}
export function fatiguePenalty(exchange) {
  return sharedFatiguePenalty(exchange);
}
export function effectiveSkill(bot, brain, aiScore, playerScore, exchange = 0) {
  return sharedEffectiveSkill(bot, brain, aiScore, playerScore, exchange);
}

function sideFromZ(z) {
  return z > 0 ? 'player' : 'ai';
}
function otherSide(side) {
  return sharedOtherSide(side);
}

function clampBotDepth(bot, zDir, targetZ) {
  const depth = Math.abs(targetZ / TABLE.halfLength);
  const minDepth = bot.minDepth ?? 0;
  const maxDepth = bot.maxDepth ?? 1;
  return zDir * clamp(depth, minDepth, maxDepth) * TABLE.halfLength;
}

export class GameEngine {
  constructor() {
    this.ball = new Vector3(0, 1, 4.5);
    this.vel = new Vector3();
    this.spin = { top: 0, side: 0 };
    this.ballRotX = 0;
    this.ballRotY = 0;
    this.player = makeRacket('player', 5);
    this.ai = makeRacket('ai', -5);
    this.firstServer = randomSide();
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.serveBounceCount = 0;
    this.exchange = 0;
    this.pointTimer = 0;
    this.aiServeTimer = 0;
    this.shake = 0;
    this.overT = 0;
    this.volley = 0;
    this.paddle = PLAYER_PADDLE;
    this.reach = PHYSICS.serveHeight;
    this.tier = getBot(DEFAULT_DIFFICULTY);
    this.attractBot = getBot(ATTRACT_BOT_ID);
    this.attractActive = false;
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
    this.shadow = makeShadow();
    this.marker = makeMarker();
    this.aim = makeAim();
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

  isAttractMode(state = useGameStore.getState()) {
    return state.revealed && !state.started && state.mode === 'offline';
  }

  resetAttractMatch() {
    useGameStore.setState({
      scoreP: 0,
      scoreAI: 0,
      phase: 'serve',
      winner: null,
      flashText: '',
      flashId: 0,
      server: 'player',
    });
    this.firstServer = randomSide();
    this.player.x = 0;
    this.ai.x = 0;
    this.player.vx = 0;
    this.ai.vx = 0;
    this.player.tell = 0;
    this.ai.tell = 0;
    this.paddle = PLAYER_PADDLE;
    this.reach = PHYSICS.serveHeight * this.paddle.play.reach;
    this.tier = this.attractBot;
    resetBrain(this.brain);
    inputHud.aiConfidence = this.brain.confidence;
    resetFx();
    this.overT = 0;
    this.volley = 0;
    this.resetServe();
  }

  syncAttractMode(state = useGameStore.getState()) {
    const attract = this.isAttractMode(state);
    if (attract && !this.attractActive) {
      this.attractActive = true;
      this.resetAttractMatch();
    } else if (!attract && this.attractActive) {
      this.attractActive = false;
      this.player.tell = 0;
      this.ai.tell = 0;
    }
    return attract;
  }


  currentServer() {
    const { scoreP, scoreAI } = useGameStore.getState();
    return sharedCurrentServer(this.firstServer, scoreP, scoreAI, sharedOtherSide);
  }

  newMatch() {
    this.firstServer = randomSide();
    this.player.x = 0;
    this.ai.x = 0;
    this.paddle = PLAYER_PADDLE;
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
    this.exchange = 0;
    this.lastHitter = null;
    this.bouncedReceiver = false;
    this.serveBounceCount = 0;
    this.vel.set(0, 0, 0);
    this.spin.top = 0;
    this.spin.side = 0;
    this.charge = 0;
    this.charging = false;
    this.chargeStartedAt = 0;
    this.reactTimer = 0;
    this.player.tell = 0;
    this.ai.tell = 0;
    this.tellSounded = false;
    resetInputHud();
    const server = this.currentServer();
    this.aiServeTimer = (this.isAttractMode() || server === 'ai') ? 1.1 : 0;
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
    if (store.phase !== 'exchange' && store.phase !== 'serve') return;
    store.setPhase('point');
    this.pointTimer = 1;
    store.bumpScore(winner);
    const { scoreP, scoreAI } = useGameStore.getState();
    const ace = reason === 'WINNER' && this.exchange === 0;
    const label = ace ? 'ACE' : reason;
    const color = winner === 'player' ? COLORS.player : COLORS.ai;
    this.fx?.shock?.(this.ball.x, this.ball.y, this.ball.z, color, 2.2);
    this.fx?.scoreText?.(this.ball.x, this.ball.y, this.ball.z, color, '+1');
    this.shake = ace ? 0.55 : 0.45;
    arenaFx.score = 1;
    raiseFx('pulse', 1);
    arenaFx.ix = this.ball.x;
    arenaFx.iz = this.ball.z;
    playMenu(winner === 'player');

    const quality = sharedPointQuality(reason, ace ? 0 : this.exchange);
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
    if ((!state.started && !this.isAttractMode(state)) || state.phase !== 'serve') return;
    const server = this.currentServer();
    const isPlayer = server === 'player';
    const racket = isPlayer ? this.player : this.ai;
    const zDir = isPlayer ? -1 : 1;
    const play = this.paddle.play;
    const ball = this.ball;
    ball.set(racket.x, racket.y + PHYSICS.paddleThickness, racket.baseZ + zDir * 0.45);

    let topSpin, sideSpin, targetX, targetZ, flightTime;
    let servedShot = null;
    const charge = isPlayer ? this.charge : 0;
    const attract = this.isAttractMode(state);
    if (isPlayer && !attract) {
      topSpin = clamp((this.pvy * CAMERA.cameraLookAhead + this.kTop) * play.spin, -0.8, 0.8);
      sideSpin = clamp(this.pvx * CAMERA.cameraZBase * play.spin, -0.8, 0.8);
      const aimX = this.aimX;
      const aimDepth = this.aimDepth;
      targetX = clamp(aimX * TABLE.halfWidth * 0.96 + sideSpin * TABLE.halfWidth * 0.22, -TABLE.halfWidth * 0.98, TABLE.halfWidth * 0.98);
      targetZ = zDir * (0.08 + aimDepth * 0.88) * TABLE.halfLength;
      flightTime = ((1 - charge * 0.25) * 0.72) / play.power;
    } else {
      const bot = attract ? this.attractBot : this.tier;
      const botScore = isPlayer ? state.scoreP : state.scoreAI;
      const opponentScore = isPlayer ? state.scoreAI : state.scoreP;
      const opponent = isPlayer ? this.ai : this.player;
      servedShot = resolveBotServe({
        side: server,
        ball: { x: ball.x, y: ball.y, z: ball.z },
        bot,
        brain: this.brain,
        botScore,
        opponentScore,
        opponentX: opponent.x,
        random: rand,
      });
      topSpin = servedShot.topSpin;
      sideSpin = servedShot.sideSpin;
      targetX = servedShot.targetX;
      targetZ = servedShot.targetZ;
      flightTime = servedShot.flightTime;
    }
    const served = servedShot || solveLegalServe(ball, targetX, targetZ, flightTime, topSpin, sideSpin, server);
    topSpin = served.topSpin;
    sideSpin = served.sideSpin;
    targetX = served.targetX;
    this.spin.top = topSpin;
    this.spin.side = sideSpin;
    this.vel.copy(served.velocity);
    this.lastHitter = server;
    this.bouncedReceiver = false;
    this.serveBounceCount = 0;
    this.charge = 0;
    if (server === 'player' && !attract) this.reactTimer = this.tier.serveReact ?? this.tier.reactionDelay;
    useGameStore.getState().setPhase('exchange');
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
    const attract = this.isAttractMode();
    const botControlled = attract || !isPlayer;
    this.exchange += 1;
    if ([8, 14, 20, 30].includes(this.exchange)) this.setCallout(`STREAK ${this.exchange}`, COLORS.ink);

    let flightTime = clamp(0.66 - this.exchange * 0.013, 0.44, 0.66);
    let topSpin, sideSpin, targetX, targetZ;
    let error = 0;
    let power = 0;
    let playerShot = null;
    let botShot = null;

    if (isPlayer && !attract) {
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
          exchange: this.exchange,
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
      const bot = attract ? this.attractBot : this.tier;
      const { scoreAI, scoreP } = useGameStore.getState();
      const opponent = isPlayer ? this.ai : this.player;
      botShot = resolveBotReturn({
        side: who,
        ball: { x: ball.x, y: ball.y, z: ball.z },
        incomingVelocity: { x: this.vel.x, y: this.vel.y, z: this.vel.z },
        exchange: this.exchange,
        bot,
        brain: this.brain,
        botScore: isPlayer ? scoreP : scoreAI,
        opponentScore: isPlayer ? scoreAI : scoreP,
        opponentX: opponent.x,
        opponentVx: opponent.vx,
        random: rand,
      });
      topSpin = botShot.spin.top;
      sideSpin = botShot.spin.side;
      targetX = botShot.target.x;
      targetZ = botShot.target.z;
      flightTime = botShot.flightTime;
      power = botShot.power || 0;
      this._aiSmash = Boolean(botShot.smash);
      this._lob = Boolean(botShot.lob);
    }

    const smash = botControlled ? this._aiSmash : playerShot?.smash;
    if (isPlayer && !botControlled && smash) power = Math.max(power, 0.85);
    if (botControlled && !botShot && smash) {
      topSpin = Math.max(topSpin, 0.2);
      flightTime = PHYSICS.spinDecay;
      targetZ = zDir * (0.72 + rand() * 0.2) * TABLE.halfLength;
      power = Math.max(power, 0.85);
    } else if (botControlled && !botShot) {
      if (topSpin > 0) {
        flightTime *= 1 - topSpin * 0.24;
        targetZ = zDir * (0.58 + rand() * 0.32) * TABLE.halfLength;
      } else if (topSpin < -0.15) {
        flightTime *= 1 + Math.abs(topSpin) * 0.32;
        targetZ = zDir * (0.34 + rand() * 0.22) * TABLE.halfLength;
      } else {
        targetZ = zDir * (0.5 + rand() * 0.35) * TABLE.halfLength;
      }
      if (botControlled && this._lob) {
        flightTime = 0.92 + rand() * 0.16;
        targetZ = zDir * (0.5 + rand() * 0.16) * TABLE.halfLength;
      }
    }

    if (botControlled && !botShot) {
      targetZ = clampBotDepth(botControlled && attract ? this.attractBot : this.tier, zDir, targetZ);
      if ((botControlled && attract ? this.attractBot : this.tier).minDepth != null && topSpin < -0.15) topSpin = Math.max(topSpin, -0.22);
    }

    let solved;
    if (isPlayer && !botControlled) {
      solved = new Vector3(playerShot.velocity.x, playerShot.velocity.y, playerShot.velocity.z);
    } else if (botShot) {
      solved = new Vector3(botShot.velocity.x, botShot.velocity.y, botShot.velocity.z);
    } else {
      const reachable = solveReachableShot(ball, targetX, targetZ, flightTime, topSpin, sideSpin, who);
      topSpin = reachable.topSpin;
      sideSpin = reachable.sideSpin;
      targetX = reachable.targetX;
      solved = new Vector3(reachable.velocity.x, reachable.velocity.y, reachable.velocity.z);
    }
    this.spin.top = topSpin;
    this.spin.side = sideSpin;
    if (error > 0 && !botShot) {
      const reachableVelocity = solved.clone();
      solved.x *= 1 + (rand() - 0.5) * 2 * error;
      solved.y *= 1 + (rand() - 0.5) * 2 * error;
      solved.z *= 1 + (rand() - 0.5) * 2 * error * 0.7;
      const contact = simulateReceiverContact(ball, solved, topSpin, sideSpin, who);
      if (contact.catchableHeight && !contact.reachableX) solved.copy(reachableVelocity);
    }
    this.vel.copy(solved);
    this.lastHitter = who;
    this.bouncedReceiver = false;
    racket.flash = 1;
    racket.swing = 1;
    const color = isPlayer ? COLORS.player : COLORS.ai;
    this.fx?.impact?.(ball.x, ball.y, ball.z, color, smash ? 1 : 0.4 + power * 0.6);
    if (smash || power > 0.6) this.fx?.shock?.(ball.x, ball.y, ball.z, color, smash ? 2.8 : 1.6);
    this.shake = (smash ? 0.55 : 0.18) + power * 0.28;
    playHit(smash ? 1 : power, this.exchange);
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

    if (isPlayer && !attract) {
      this.charge = 0;
      inputHud.power = power;
      inputHud.spinX = sideSpin;
      inputHud.spinY = topSpin;
      inputHud.spinMag = Math.min(1, Math.hypot(sideSpin, topSpin));
      inputHud.spinLabel = playerShot?.intent === 'lob' ? 'LOB' : playerShot?.intent === 'block' ? 'BLOCK' : Math.abs(sideSpin) > 0.35 ? 'SIDESPIN' : topSpin > 0.3 ? 'TOPSPIN' : topSpin < -0.2 ? 'CHOP' : '';
      this.reactTimer = this.tier.reactionDelay;
    } else {
      racket.tell = 0;
      this.tellSounded = false;
    }
  }

  updateBotPaddle(who, dt, phase, bot) {
    const racket = who === 'player' ? this.player : this.ai;
    const target = resolveBotPaddleTarget({
      side: who,
      ball: this.ball,
      velocity: this.vel,
      spin: this.spin,
      phase,
      lastHitter: this.lastHitter,
      exchange: this.exchange,
      bot,
      currentX: racket.x,
    });
    stepBotPaddle({ racket, target, dt, bot, exchange: this.exchange });
  }

  updateAI(dt, phase) {
    if (this.reactTimer > 0) this.reactTimer -= dt;
    const target = this.reactTimer <= 0
      ? resolveBotPaddleTarget({
          side: 'ai',
          ball: this.ball,
          velocity: this.vel,
          spin: this.spin,
          phase,
          lastHitter: this.lastHitter,
          exchange: this.exchange,
          bot: this.tier,
          currentX: this.ai.x,
        })
      : this.ai.x * 0.7;
    stepBotPaddle({ racket: this.ai, target, dt, bot: this.tier, exchange: this.exchange });
  }

  handleBounce() {
    const ball = this.ball;
    if (!(Math.abs(ball.x) <= 2.97) || !(Math.abs(ball.z) <= 4.87)) return false;
    applyBounce(ball, this.vel, this.spin);
    const side = sideFromZ(ball.z);
    this.fx?.ring?.(ball.x, ball.z);
    raiseFx('bounce', 1);
    raiseFx('pulse', 0.4);
    arenaFx.ix = ball.x;
    arenaFx.iz = ball.z;
    playBounce();
    const result = resolveBouncePoint({
      side,
      lastHitter: this.lastHitter,
      exchange: this.exchange,
      serveBounceCount: this.serveBounceCount,
      bouncedReceiver: this.bouncedReceiver,
    });
    this.serveBounceCount = result.serveBounceCount ?? this.serveBounceCount;
    this.bouncedReceiver = result.bouncedReceiver ?? this.bouncedReceiver;
    if (result.winner) this.point(result.winner, result.reason);
    return true;
  }

  handleNet(prevZ) {
    const ball = this.ball;
    if (!detectNet(prevZ, this.prevBallY, ball)) return false;
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
    const ball = this.ball;
    const racket = who === 'player' ? this.player : this.ai;
    const contact = detectRacketContact({
      side: who,
      prev: { x: this.prevBallX, y: this.prevBallY, z: prevZ },
      ball,
      velocity: this.vel,
      racketX: racket.x,
      reach: who === 'player' ? this.reach : PHYSICS.serveHeight,
      minY: who === 'player' ? 0.05 : racket.y - 1,
      maxY: who === 'player' ? 3.4 : racket.y + 1,
      racketZ: PHYSICS.gravity,
    });
    if (contact) {
      ball.set(contact.x, contact.y, contact.z);
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
  }

  onPointerDown(event) {
    if (this.isAttractMode()) return;
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
    if (this.isAttractMode()) return;
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
    if (this.isAttractMode()) return;
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
    if (this.isAttractMode()) return;
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
    let state = useGameStore.getState();
    const attract = this.syncAttractMode(state);
    if (attract) state = useGameStore.getState();
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
    if (!state.started && !attract) {
      this.idle(dt, time, camera);
      return;
    }
    if (!attract && state.menuOpen && state.phase !== 'over') {
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

    const exchanging = phase === 'exchange';
    arenaFx.heat = damp(arenaFx.heat, exchanging ? clamp(0.16 + this.exchange * 0.07, 0, 1) : 0, exchanging ? 2.6 : 1, dt);
    decayFx(dt);
    arenaFx.serveCharge = this.charge;
    arenaFx.exchangeN = this.exchange;

    this.pvx = damp(this.pvx, 0, 9, dt);
    this.pvy = damp(this.pvy, 0, 9, dt);
    this.kTop = damp(this.kTop, 0, 6, dt);

    player.prevX = player.x;
    if (attract) {
      this.updateBotPaddle('player', dt, phase, this.attractBot);
      this.updateBotPaddle('ai', dt, phase, this.attractBot);
    } else {
      const dir = Number(!!this.keys.r) - Number(!!this.keys.l);
      if (dir) this.inputX = clamp(this.inputX + dir * 19 * state.playerSpeed * dt, -TABLE.halfWidth - 0.5, TABLE.halfWidth + 0.5);

      if (camera) {
        this.ndc.set(this.ndcX, this.ndcY);
        this.ray.setFromCamera(this.ndc, camera);
        if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
          this.aimX = clamp(this.hit.x / (TABLE.halfWidth + 0.5), -1, 1);
        }
      }
      this.aimDepth = clamp((this.ndcY + 1) * 0.5, 0, 1);

      player.x = damp(player.x, this.inputX, this.paddle.play.follow * 32 * state.playerSpeed, dt);
      player.vx = (player.x - player.prevX) / Math.max(dt, 0.000001);
      this.updateAI(dt, phase);
    }

    const aiCanSmashTell = phase === 'exchange' && this.lastHitter === 'player' && this.bouncedReceiver && this.tier.smashChance > 0.25 && ball.z < -2.4 && this.vel.z < 0 && ball.y > 0.68;
    ai.tell = damp(ai.tell, Number(!!aiCanSmashTell), aiCanSmashTell ? 10 : 8, dt);
    if (aiCanSmashTell && !this.tellSounded && ai.tell > 0.4) {
      playCharge(0.85);
      this.tellSounded = true;
    }
    if (!aiCanSmashTell) this.tellSounded = false;

    const canCharge = !attract && (phase === 'exchange' || (phase === 'serve' && server === 'player'));
    if (this.charging && canCharge) {
      const old = this.charge;
      this.charge = Math.min(1, this.charge + dt / PHYSICS.hitReach);
      if (Math.floor(old * 4) !== Math.floor(this.charge * 4)) playCharge(this.charge);
    } else {
      this.charge = Math.max(0, this.charge - PHYSICS.playerReach * dt);
    }
    inputHud.charge = this.charge;
    inputHud.charging = this.charging && canCharge;
    inputHud.exchange = this.exchange;
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
      const incoming = phase === 'exchange' && this.lastHitter !== who && this.lastHitter !== null;
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
      if (server === 'ai' || attract) {
        if (this.swoop >= 1) this.aiServeTimer -= dt;
        if (this.aiServeTimer <= 0) this.serve();
      }
    } else if (phase === 'exchange' || phase === 'point') {
      this.prevBallX = ball.x;
      this.prevBallY = ball.y;
      const prevZ = ball.z;
      stepBall(ball, this.vel, this.spin, dt);
      if (phase === 'exchange') {
        if (!this.handleNet(prevZ)) {
          this.checkRacketHit('player', prevZ);
          this.checkRacketHit('ai', prevZ);
        }
        if (this.vel.y < 0 && ball.y <= TABLE.ballRadius && !this.handleBounce() && ball.y < -1.2) {
          const serveFault = this.lastHitter && this.exchange === 0 && this.serveBounceCount < 2;
          this.point(serveFault ? otherSide(this.lastHitter) : this.bouncedReceiver ? this.lastHitter : otherSide(this.lastHitter), serveFault ? 'FAULT' : this.bouncedReceiver ? 'WINNER' : 'OUT');
        }
        if (Math.abs(ball.z) > 7.95 || Math.abs(ball.x) > 6.05 || ball.y < -1.6) {
          const serveFault = this.lastHitter && this.exchange === 0 && this.serveBounceCount < 2;
          this.point(serveFault ? otherSide(this.lastHitter) : this.bouncedReceiver ? this.lastHitter : otherSide(this.lastHitter), serveFault ? 'FAULT' : this.bouncedReceiver ? 'WINNER' : 'OUT');
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
    updateShadow(this.shadow, ball, TABLE);
    const aiming = !attract && (phase === 'exchange' || (phase === 'serve' && server === 'player'));
    this.aim.x = this.aimX * TABLE.halfWidth * 0.96;
    this.aim.z = -(0.08 + this.aimDepth * 0.88) * TABLE.halfLength;
    this.aim.op = aiming ? clamp(0.12 + this.charge * 0.6, 0, 0.78) : 0;
    this.aim.spinX = clamp(this.pvx * 0.12, -1, 1);
    this.aim.spinY = clamp((this.pvy + this.kTop) * 0.12, -1, 1);
    this.aim.power = this.charge;

    if (phase === 'exchange' && this.lastHitter === 'ai' && !this.bouncedReceiver) {
      resetMarker(this.marker);
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
      resetMarker(this.marker);
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

    if (attract && phase === 'over' && this.overT >= ATTRACT_RESET_DELAY) {
      this.resetAttractMatch();
      return;
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
    arenaFx.exchangeN = 0;

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
    updateShadow(this.shadow, ball, TABLE);
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
