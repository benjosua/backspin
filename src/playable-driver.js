import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { COLORS, TABLE } from './constants.js';
import { damp } from './fx-state.js';
import { syncCursorScreen as syncInputCursorScreen, setInputCallout } from './view-state.js';
import { applyPointerVelocity, MOVE_AXIS_DEADZONE, pointerEventToNdc, updateAimFromCamera } from './input-utils.js';
import { initAudio } from './audio.js';
import {
  applyGameplayFx,
  assignDriverViewState,
  syncGameplayAimAndHud,
  updateArenaVisuals,
  updateBallVisuals,
  updateGameplayCamera,
  updateGameplayPaddles,
  updateProjectionVisual,
} from './game-driver-view.js';
import { inputHud } from './view-state.js';
import { useGameStore } from './store.js';
import { NET } from '../shared/backspin-core.js';

const clamp = MathUtils.clamp;

export class PlayableDriver {
  constructor() {
    assignDriverViewState(this, 'desktop');
    this.overT = 0; 
    this.volley = 0;
    this.inputX = 0; 
    this.aimX = 0; 
    this.aimDepth = 0.5; 
    this.ndcX = 0; 
    this.ndcY = 0;
    this.pvx = 0; 
    this.pvy = 0; 
    this.kTop = 0; 
    this.charging = false; 
    this.charge = 0;
    this.chargeStartedAt = 0;
    this.moveAxis = 0;
    this.usingKeys = false; 
    this.keys = { l: false, r: false }; 
    this.movePID = null; 
    this.pointerLocked = false;
    this.fx = null;
    this.lastT = 0;
    this.lastNdcX = 0;
    this.lastNdcY = 0;
    
    this.ray = new Raycaster(); 
    this.plane = new Plane(new Vector3(0, 1, 0), -0.62); 
    this.aimPlane = new Plane(new Vector3(0, 1, 0), -0.048); 
    this.ndc = new Vector2(); 
    this.hit = new Vector3();
  }

  onChargeStart() {}

  onChargeEnd() {}

  handleEmoteKey(event) { return false; }

  setCallout(text, color = COLORS.ai) { 
    setInputCallout(text, color); 
  }
  
  syncCursorScreen() { 
    syncInputCursorScreen(this); 
  }
  
  setPointerLocked(locked) { 
    this.pointerLocked = locked; 
    if (locked) this.syncCursorScreen(); 
  }
  
  onPointerMove(event) { 
    if (event.pointerType !== 'mouse' && event.pointerId !== this.movePID) return; 
    const { x, y } = pointerEventToNdc(event, this.ndcX, this.ndcY, this.pointerLocked); 
    applyPointerVelocity(this, event, x, y); 
    this.syncCursorScreen(); 
  }
  
  onPointerDown(event) { 
    if (event.pointerType !== 'mouse' || event.button === 0) { 
      initAudio(); 
      if (event.pointerType !== 'mouse') { 
        if (this.movePID !== null) return; 
        this.movePID = event.pointerId; 
      } 
      this.onPointerMove(event); 
      if (!this.charging) this.chargeStartedAt = event.timeStamp / 1000; 
      this.charging = true; 
      this.onChargeStart();
    } 
  }
  
  onPointerUp(event) { 
    if (event?.pointerType === 'mouse' && event.button !== 0) return; 
    if (event?.pointerType !== 'mouse' && event?.pointerId === this.movePID) this.movePID = null; 
    this.charging = false; 
    this.onChargeEnd();
  }
  
  onKeyDown(event) { 
    if (this.handleEmoteKey(event)) return;
    
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') { this.keys.l = true; this.usingKeys = true; } 
    if (event.code === 'ArrowRight' || event.code === 'KeyD') { this.keys.r = true; this.usingKeys = true; } 
    if (event.code === 'ArrowUp' || event.code === 'KeyW') this.kTop = 0.85; 
    if (event.code === 'ArrowDown' || event.code === 'KeyS') this.kTop = -0.7; 
    if (event.code === 'Space' || event.code === 'Enter') { 
      initAudio(); 
      this.charging = true; 
      this.onChargeStart();
      event.preventDefault(); 
    } 
  }
  
  onKeyUp(event) { 
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.keys.l = false; 
    if (event.code === 'ArrowRight' || event.code === 'KeyD') this.keys.r = false; 
    if (event.code === 'Space' || event.code === 'Enter') { 
      this.charging = false; 
      this.onChargeEnd();
    } 
  }

  setMoveAxis(axis = 0) {
    this.moveAxis = clamp(Number(axis) || 0, -1, 1);
  }

  sideColor(side) { return side === 'p1' ? COLORS.player : COLORS.ai; }

  winnerIsLocal(side) { return side === 'p1'; }

  processGameEvent(event, options = {}) {
    if (!event) return;
    if (event.type === 'bounce' || event.type === 'shot' || event.type === 'hit' || event.type === 'point' || event.type === 'net') {
      applyGameplayFx(this, event, {
        exchange: options.exchange ?? this.eventExchange ?? 0,
        sideColor: options.sideColor || ((side) => this.sideColor(side)),
        winnerIsLocal: options.winnerIsLocal || ((side) => this.winnerIsLocal(side)),
        pointLabel: options.pointLabel ?? '',
        playAudio: options.playAudio ?? true,
      });
    }
  }

  processGameEvents(events, options = {}) {
    for (const event of events || []) this.processGameEvent(event, options);
  }

  syncPlayStore(state, { sideToStore = (side) => side, extra = {}, setter = 'setState' } = {}) {
    const patch = {
      scoreP: state.scoreP,
      scoreAI: state.scoreAI,
      phase: state.phase,
      server: state.server,
      winner: state.winner,
      ...extra,
    };
    if (state.core) {
      patch.scoreP = state.core.scores.p1;
      patch.scoreAI = state.core.scores.p2;
      patch.phase = state.core.phase === 'exchange' ? 'exchange' : state.core.phase;
      patch.server = sideToStore(state.core.server);
      patch.winner = state.core.winner ? sideToStore(state.core.winner) : null;
    }
    const store = useGameStore.getState();
    if (setter === 'syncOnlineState') store.syncOnlineState(patch);
    else useGameStore.setState(patch);
  }

  updateVisuals(dt, time, {
    phase = 'exchange',
    exchange = 0,
    charge = inputHud.charge,
    playerIncoming = false,
    aiIncoming = false,
    projection = {},
    arena = {},
    camera = true,
  } = {}) {
    updateGameplayPaddles(this, dt, { playerIncoming, aiIncoming });
    updateBallVisuals(this, dt);
    updateProjectionVisual(this, { phase, ...projection });
    updateArenaVisuals(this, phase, exchange, charge, dt, time, arena);
    if (camera) updateGameplayCamera(this, dt, time);
  }

  updateAimHud(options = {}) {
    syncGameplayAimAndHud(this, options);
  }

  updateCommonVisuals(dt, time, store, localPhase, localExchange, localCharge, playerIncoming, aiIncoming, raiseOverScore) {
    this.updateAimHud({
      charge: localCharge,
      charging: this.charging,
      exchange: localExchange,
      canInfluence: localPhase === 'exchange' || (localPhase === 'serve' && store.server === 'player'),
    });
    this.updateVisuals(dt, time, {
      phase: localPhase,
      exchange: localExchange,
      charge: localCharge,
      playerIncoming,
      aiIncoming,
      arena: { raiseOverScore },
      projection: { incoming: playerIncoming },
    });
  }

  updateCameraVisual(dt, time) {
    updateGameplayCamera(this, dt, time);
  }

  updateInputState(dt, playerSpeed, camera) {
    updateAimFromCamera(this, camera);
    const keyDir = Number(!!this.keys.r) - Number(!!this.keys.l);
    const dir = Math.abs(this.moveAxis) > MOVE_AXIS_DEADZONE ? this.moveAxis : keyDir;
    if (dir) {
      this.inputX = clamp(this.inputX + dir * 19 * playerSpeed * dt, -TABLE.halfWidth - NET.paddleInset, TABLE.halfWidth + NET.paddleInset);
    }
    this.pvx = damp(this.pvx, 0, 9, dt);
    this.pvy = damp(this.pvy, 0, 9, dt);
    this.kTop = damp(this.kTop, 0, 6, dt);
  }
}
