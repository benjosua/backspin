import { Vector3 } from 'three';
import { CAMERA, COLORS, TABLE } from './constants.js';
import { arenaFx, damp, decayFx, raiseFx } from './fx-state.js';
import { playBounce, playHit, playMenu, playNet } from './audio.js';
import { inputHud, setInputCallout, syncInputHudAimAndSpin } from './view-state.js';
import { aimTargetFromInput } from './input-utils.js';
import {
  CONTACT,
  makeAim,
  makeMarker,
  makeRacket,
  makeShadow,
  resetMarker,
  sampleBallPlan,
  updateIncomingProjection,
  updateShadow,
} from '../shared/backspin-core.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function serveBallForCore(core) {
  const p = core.players[core.server];
  return {
    x: p.x,
    y: 0.96,
    z: core.server === 'p1' ? CONTACT.racketZ - 0.45 : -CONTACT.racketZ + 0.45,
    vx: 0,
    vy: 0,
    vz: 0,
    spinTop: 0,
    spinSide: 0,
  };
}

export function serveBallForRacket(racket) {
  return {
    x: racket.x,
    y: 0.96,
    z: racket.baseZ + (racket.who === 'player' ? -0.45 : 0.45),
    vx: 0,
    vy: 0,
    vz: 0,
    spinTop: 0,
    spinSide: 0,
  };
}

export function createDriverViewState(cameraPreset = 'desktop') {
  const position = cameraPreset === 'replay' ? CAMERA.playPosition : CAMERA.desktopPosition;
  const target = cameraPreset === 'replay' ? CAMERA.playTarget : CAMERA.desktopTarget;
  const [x, y, z] = position;
  const [lx, ly, lz] = target;
  return {
    ball: new Vector3(0, cameraPreset === 'replay' ? 0.34 : 1, cameraPreset === 'replay' ? 0 : 4.5),
    vel: new Vector3(),
    spin: { top: 0, side: 0 },
    player: makeRacket('player', CONTACT.racketZ),
    ai: makeRacket('ai', -CONTACT.racketZ),
    brain: { confidence: 0.5 },
    shadow: makeShadow(),
    marker: makeMarker(),
    aim: makeAim(),
    netWobble: 0,
    netRotX: 0,
    ballRotX: 0,
    ballRotY: 0,
    shake: 0,
    camX: x,
    camY: y,
    camZ: z,
    camLX: lx,
    camLY: ly,
    camLZ: lz,
    camFov: cameraPreset === 'replay' ? 50 : 44,
  };
}

export function assignDriverViewState(driver, cameraPreset = 'desktop') {
  Object.assign(driver, createDriverViewState(cameraPreset));
  return driver;
}

export function syncCoreSample(driver, core) {
  const sample = core.phase === 'serve' ? serveBallForCore(core) : sampleBallPlan(core.ballPlan, core.nowMs);
  driver.ball.set(sample.x, sample.y, sample.z);
  driver.vel.set(sample.vx || 0, sample.vy || 0, sample.vz || 0);
  driver.spin.top = sample.spinTop || 0;
  driver.spin.side = sample.spinSide || 0;
  return sample;
}

export function syncGameplayAimAndHud(driver, { charge = 0, charging = false, exchange = 0, canInfluence = true } = {}) {
  syncInputHudAimAndSpin(driver, { charge, charging, exchange, canInfluence });
  syncAimVisual(driver, canInfluence);
}

export function syncAimVisual(driver, canInfluence = true) {
  const aimTarget = aimTargetFromInput(driver.aimX, driver.aimDepth);
  driver.aim.x = aimTarget.x;
  driver.aim.z = aimTarget.z;
  driver.aim.op = canInfluence ? clamp(0.12 + inputHud.charge * 0.6, 0, 0.78) : 0;
  driver.aim.spinX = inputHud.spinX;
  driver.aim.spinY = inputHud.spinY;
  driver.aim.power = inputHud.charge;
}

export function updatePaddlePose(racket, { dt, incoming = false, ballY = 0.62, replay = false } = {}) {
  const sign = racket.who === 'player' ? 1 : -1;
  const maxY = racket.who === 'player' ? 2.6 : 1.8;
  racket.swing = Math.max(0, racket.swing - dt * 4.5);
  racket.flash = Math.max(0, racket.flash - dt * 4);
  if (replay) {
    racket.y = damp(racket.y, incoming ? clamp(ballY, 0.42, maxY) : 0.62, 8, dt);
    racket.z = racket.baseZ - sign * racket.swing * 0.45;
    racket.rotX = (racket.who === 'player' ? -0.22 : 0.22) - sign * racket.swing * 0.6;
    racket.rotZ = damp(racket.rotZ, clamp(-racket.vx * 0.12, -0.45, 0.45), 10, dt);
    return;
  }
  racket.y = damp(racket.y, incoming ? clamp(ballY, 0.42, maxY) : 0.62, 8, dt);
  racket.z = racket.baseZ - sign * racket.swing * 0.45;
  racket.rotX = (racket.who === 'player' ? -0.22 : 0.22) - sign * racket.swing * 0.6;
  racket.rotZ = damp(racket.rotZ, -racket.vx * 0.018, 12, dt);
}

export function updateGameplayPaddles(driver, dt, { playerIncoming = false, aiIncoming = false } = {}) {
  updatePaddlePose(driver.player, { dt, incoming: playerIncoming, ballY: driver.ball.y });
  updatePaddlePose(driver.ai, { dt, incoming: aiIncoming, ballY: driver.ball.y });
}

export function updateReplayPaddles(driver, dt, { playerIncoming = false, aiIncoming = false } = {}) {
  updatePaddlePose(driver.player, { dt, replay: true, incoming: playerIncoming, ballY: driver.ball.y });
  updatePaddlePose(driver.ai, { dt, replay: true, incoming: aiIncoming, ballY: driver.ball.y });
}

export function updateBallVisuals(driver, dt) {
  driver.ballRotX -= (2 + driver.spin.top * 16) * dt;
  driver.ballRotY += driver.spin.side * 14 * dt;
  updateShadow(driver.shadow, driver.ball, TABLE);
}

export function updateProjectionVisual(driver, options = {}) {
  updateIncomingProjection(driver.marker, { ball: driver.ball, velocity: driver.vel, spin: driver.spin, ...options });
}

export function updateArenaVisuals(driver, phase, exchange, charge, dt, time, options = {}) {
  const heatTarget = options.replay
    ? clamp(0.12 + exchange * 0.05, 0, 0.8)
    : phase === 'exchange' ? clamp(0.16 + exchange * 0.07, 0, 1) : 0;
  arenaFx.heat = damp(arenaFx.heat, heatTarget, 2, dt);
  arenaFx.serveCharge = options.replay ? 0 : charge;
  arenaFx.exchangeN = exchange;
  decayFx(dt);
  if (options.raiseOverScore && phase === 'over') raiseFx('score', 0.2);
  driver.netWobble = Math.max(0, driver.netWobble - dt * 2.2);
  driver.netRotX = Math.sin(time * 26) * driver.netWobble * 0.1;
}

export function updateGameplayCamera(driver, dt, time) {
  const heat = arenaFx.heat;
  const bob = Math.sin(time * (1 + heat)) * (0.03 + heat * 0.07);
  driver.shake = Math.max(0, (driver.shake || 0) - dt * 1.8);
  driver.camX = damp(driver.camX, CAMERA.introPosition[0] + (driver.ndcX || 0) * 0.7, 2.5, dt);
  driver.camY = damp(driver.camY, CAMERA.introPosition[1] + (driver.ndcY || 0) * 0.35 + bob, 2.5, dt);
  driver.camZ = damp(driver.camZ, CAMERA.introPosition[2] - heat * 1.4, 2.8, dt);
  driver.camLX = damp(driver.camLX, CAMERA.introTarget[0], 2.4, dt);
  driver.camLY = damp(driver.camLY, CAMERA.introTarget[1], 2.4, dt);
  driver.camLZ = damp(driver.camLZ, CAMERA.introTarget[2], 2.4, dt);
  driver.camFov = damp(driver.camFov, 38, 2.6, dt);
}

export function applyGameplayFx(driver, event, {
  exchange = 0,
  sideColor = () => COLORS.ai,
  winnerIsLocal = () => false,
  pointLabel = 'POINT',
  playAudio = true,
} = {}) {
  if (!event) return;
  if (event.type === 'bounce') {
    driver.fx?.ring?.(event.x || 0, event.z || 0);
    if (playAudio) playBounce();
    raiseFx('bounce', 1);
    return;
  }
  if (event.type === 'shot' || event.type === 'hit') {
    const color = sideColor(event.side);
    const smash = Boolean(event.smash);
    driver.fx?.impact?.(driver.ball.x, driver.ball.y, driver.ball.z, color, smash ? 1 : 0.5);
    if (playAudio) playHit(smash ? 1 : 0.4, exchange);
    if (smash) {
      setInputCallout('SMASH', color);
      raiseFx('smash', 1);
    }
    return;
  }
  if (event.type === 'point') {
    const localWon = winnerIsLocal(event.winner);
    const color = localWon ? COLORS.player : COLORS.ai;
    if (playAudio) playMenu(localWon);
    driver.fx?.scoreText?.(driver.ball.x, driver.ball.y, driver.ball.z, color, '+1');
    driver.fx?.shock?.(driver.ball.x, driver.ball.y, driver.ball.z, color, 2.2);
    raiseFx('score', 1);
    if (pointLabel) setInputCallout(pointLabel, color);
    return;
  }
  if (event.type === 'net' && playAudio) playNet();
}

export function clearAimAndProjection(driver) {
  resetMarker(driver.marker);
  driver.aim.op = 0;
}
