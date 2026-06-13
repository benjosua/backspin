import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { COLORS, TABLE } from './constants.js';
import { damp } from './fx-state.js';
import { syncCursorScreen as syncInputCursorScreen, setInputCallout } from './view-state.js';
import { applyPointerVelocity, pointerEventToNdc, updateAimFromCamera } from './input-utils.js';
import { initAudio } from './audio.js';
import { assignDriverViewState } from './game-driver-view.js';
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

  updateInputState(dt, playerSpeed, camera) {
    updateAimFromCamera(this, camera);
    const dir = Number(!!this.keys.r) - Number(!!this.keys.l);
    if (dir) {
      this.inputX = clamp(this.inputX + dir * 19 * playerSpeed * dt, -TABLE.halfWidth - NET.paddleInset, TABLE.halfWidth + NET.paddleInset);
    }
    this.pvx = damp(this.pvx, 0, 9, dt);
    this.pvy = damp(this.pvy, 0, 9, dt);
    this.kTop = damp(this.kTop, 0, 6, dt);
  }
}
