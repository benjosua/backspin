import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { COLORS, TABLE } from './constants.js';
import { arenaFx, clampDt, damp, decayFx, raiseFx, resetFx } from './fx-state.js';
import { initAudio, playHit } from './audio.js';
import { applyPointerVelocity, pointerEventToNdc, updateAimFromCamera } from './input-utils.js';
import { inputHud, resetInputHud, setInputCallout, decayInputCallout, syncCursorScreen as syncInputCursorScreen } from './view-state.js';
import {
  clearAimAndProjection,
  syncCoreSample,
} from './game-driver-view.js';
import { useGameStore, randomSide } from './store.js';
import {
  DEFAULT_DIFFICULTY,
  botInputForState,
  createGame,
  getBot,
  NET,
  serve as coreServe,
  submitInput,
  advanceGame,
} from '../shared/backspin-core.js';
import { PlayableDriver } from './playable-driver.js';

const clamp = MathUtils.clamp;
function localSideToStore(side) { return side === 'p1' ? 'player' : 'ai'; }

export class GameEngine extends PlayableDriver {
  constructor() {
    super();
    this.core = createGame({ firstServer: randomSide() === 'player' ? 'p1' : 'p2' });
  }
  
  currentServer() { return localSideToStore(this.core.server); }
  
  newMatch() {
    const firstServer = randomSide() === 'player' ? 'p1' : 'p2';
    this.core = createGame({ firstServer, seed: Date.now() });
    this.inputX = 0; this.aimX = 0; this.aimDepth = 0.5; this.player.x = 0; this.ai.x = 0; this.overT = 0; this.volley = 0;
    resetFx(); resetInputHud(); this.syncStore(); this.syncRender(0);
  }
  
  resetServe() { this.core.phase = 'serve'; this.core.ballPlan = null; this.syncStore(); }
  
  serve() {
    const state = useGameStore.getState();
    if (!state.started || state.phase !== 'serve') return;
    const side = this.core.server;
    if (side === 'p1') initAudio();
    const result = coreServe(this.core, side);
    this.handleEvents(result.events);
    playHit(this.core.players[side].charge || 0, 0);
    raiseFx('pulse', 0.6);
    this.syncStore();
  }

  onChargeEnd() {
    const state = useGameStore.getState();
    if (state.phase === 'serve' && state.server === 'player') this.serve();
  }
  
  submitLocalInput(dt, camera) {
    const store = useGameStore.getState();
    this.updateInputState(dt, store.playerSpeed, camera);
    submitInput(this.core, { side: 'p1', targetX: this.inputX, aimX: this.aimX, aimDepth: this.aimDepth, swipeX: this.pvx, swipeY: this.pvy + this.kTop, charging: this.charging, speed: store.playerSpeed });
    submitInput(this.core, botInputForState(this.core, 'p2', getBot(store.difficulty || DEFAULT_DIFFICULTY)));
  }
  
  sideColor(side) { return side === 'p1' ? COLORS.player : COLORS.ai; }

  winnerIsLocal(side) { return localSideToStore(side) === 'player'; }

  handleEvents(events) {
    for (const event of events) {
      if (!event) continue;
      this.processGameEvent(event, { exchange: this.core.exchange });
      if (event.type === 'point') {
        const winner = localSideToStore(event.winner); const color = winner === 'player' ? COLORS.player : COLORS.ai; const label = event.reason === 'WINNER' && this.core.exchange === 0 ? 'ACE' : event.reason;
        useGameStore.setState({ scoreP: event.scoreP1, scoreAI: event.scoreP2, phase: event.over ? 'over' : 'point', winner: event.over ? winner : null, flashText: label, flashColor: color, flashId: useGameStore.getState().flashId + 1 });
        if (event.over) { this.overT = 0; this.volley = 0; }
      }
    }
  }
  
  syncStore() {
    this.syncPlayStore({ core: this.core }, { sideToStore: localSideToStore });
  }
  
  syncRender(dt) {
    syncCoreSample(this, this.core);
    this.player.prevX = this.player.x; this.ai.prevX = this.ai.x;
    this.player.x = this.core.players.p1.x; this.ai.x = this.core.players.p2.x; this.player.vx = this.core.players.p1.vx; this.ai.vx = this.core.players.p2.vx;
    this.updateVisuals(0, 0, { phase: this.core.phase, playerIncoming: this.core.phase === 'exchange' && this.core.lastHitter === 'p2', aiIncoming: this.core.phase === 'exchange' && this.core.lastHitter === 'p1', projection: { incoming: this.core.phase === 'exchange' && this.core.lastHitter === 'p2' }, arena: { replay: true }, camera: false });
  }
  
  update(dt, time, camera, effects) {
    this.fx = effects; dt = clampDt(dt); const store = useGameStore.getState();
    if (!store.started || store.mode !== 'offline') { this.idle(dt, time, camera); return; }
    if (store.menuOpen && store.phase !== 'over') { decayFx(dt); inputHud.charging = false; return; }
    
    decayInputCallout(dt);
    this.submitLocalInput(dt, camera);
    
    if (this.core.phase === 'serve' && this.core.server === 'p2' && this.core.players.p2.charge > 0.32) this.serve();
    
    const { events } = advanceGame(this.core, dt); 
    this.handleEvents(events); 
    this.syncStore(); 
    this.syncRender(dt);
    
    const playerIncoming = this.core.phase === 'exchange' && this.core.lastHitter === 'p2';
    const aiIncoming = this.core.phase === 'exchange' && this.core.lastHitter === 'p1';
    this.updateCommonVisuals(dt, time, store, this.core.phase, this.core.exchange, this.core.players.p1.charge, playerIncoming, aiIncoming, false);
    if (this.core.phase === 'over') this.overT += dt;
  }
  
  updateCamera(dt, time) { this.updateCameraVisual(dt, time); }
  
  pauseFrame(dt) { decayFx(dt); arenaFx.heat = damp(arenaFx.heat, 0, 1.4, dt); inputHud.charging = false; }
  
  idle(dt, time, camera) { 
    if (camera) { 
      this.ndc.set(this.ndcX, this.ndcY); 
      this.ray.setFromCamera(this.ndc, camera); 
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) this.inputX = clamp(this.hit.x * 0.6, -TABLE.halfWidth * 0.7, TABLE.halfWidth * 0.7); 
    } 
    this.player.x = damp(this.player.x, this.inputX, 6, dt); 
    this.ai.x = damp(this.ai.x, 0, 3, dt); 
    this.ball.set(damp(this.ball.x, 0, 3, dt), damp(this.ball.y, 0.34 + Math.sin(time * 1.5) * 0.04, 3, dt), damp(this.ball.z, 0, 3, dt)); 
    this.updateVisuals(0, time, { phase: 'idle', arena: { replay: true } }); 
    clearAimAndProjection(this); 
    decayFx(dt); 
    this.updateCamera(dt, time); 
  }
}

export const game = new GameEngine();

export function makeBrain() { return { confidence: 0.5 }; }
export function resetBrain(brain) { brain.confidence = 0.5; return brain; }
export function updateBrain(brain, aiWonPoint, q = 0.5) { brain.confidence = clamp(brain.confidence + (aiWonPoint ? 1 : -1) * q * 0.1, 0.08, 0.96); return brain.confidence; }
export function fatiguePenalty(exchange) { return Math.min(0.28, Math.max(0, exchange - 5) * 0.014); }
export function effectiveSkill(bot, brain) { return clamp((bot?.skill || 0.5) + (brain.confidence - 0.5) * 0.1, 0.2, 0.98); }
