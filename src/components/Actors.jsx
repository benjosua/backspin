// Recovered actor cluster from production bundle name `rk` and helpers:
// xO/SO glow textures, TO/MO paddles, FO ball trail, VO net, YO effects.

import { Trail, RoundedBox, Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  NearestFilter,
  NormalBlending,
  Object3D,
  ShaderMaterial,
  Vector3,
} from 'three';
import { COLORS, CPU_PADDLE, PHYSICS, PLAYER_PADDLE, TABLE, TUNING } from '../constants.js';
import { perfSettings } from '../performance.js';
import { arenaFx, clampDt, damp } from '../fx-state.js';
import { getDebugTime } from '../debug-tuning.js';
import { game, inputHud } from '../engine.js';
import { networkGame } from '../network.js';
import { DEBUG_MODE, useGameStore } from '../store.js';
import { paddleFragmentShader, paddleVertexShader } from '../shaders.js';
import { createPaddleHeadShape, paddleHeadExtrude } from '../paddleShape.js';
import { MONTSERRAT_FONT_URL } from '../fonts.js';

function makeGlowTexture(rgb, strong = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (strong) {
    gradient.addColorStop(0, `rgba(${rgb},0.85)`);
    gradient.addColorStop(0.55, `rgba(${rgb},0.45)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
  } else {
    gradient.addColorStop(0, `rgba(${rgb},0.8)`);
    gradient.addColorStop(0.35, `rgba(${rgb},0.3)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

function makeRingTexture(rgb = '255,255,255') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = `rgba(${rgb},0.95)`;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(64, 64, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${rgb},0.3)`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.stroke();
  return new CanvasTexture(canvas);
}

function makePaddleFaceMaterial(paddle) {
  return new ShaderMaterial({
    defines: { STYLE: paddle.style },
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new Color('#d9665f') },
      uEdge: { value: new Color('#c85f59') },
      uAccent: { value: new Color(paddle.colors.accent) },
      uCharge: { value: 0 },
      uHit: { value: 0 },
      uEnergy: { value: 0 },
    },
    vertexShader: paddleVertexShader,
    fragmentShader: paddleFragmentShader,
    side: DoubleSide,
  });
}

const headShape = createPaddleHeadShape();
const faceShape = createPaddleHeadShape(0.96);
const facePlaneZ = 0.027;

function PaddleGeometry({ faceMat, paddle }) {
  const colors = paddle.colors;
  return (
    <>
      <mesh position={[0, 0, -0.0225]}>
        <extrudeGeometry args={[headShape, paddleHeadExtrude]} />
        <meshStandardMaterial color="#c85f59" roughness={0.76} metalness={0} />
      </mesh>
      <mesh position={[0, 0, facePlaneZ]}>
        <shapeGeometry args={[faceShape, 32]} />
        <primitive object={faceMat} attach="material" />
      </mesh>
      <RoundedBox args={[0.21, 0.74, 0.052]} radius={0.032} smoothness={3} position={[0, -0.87, 0]}>
        <meshStandardMaterial color="#b98255" roughness={0.86} metalness={0} />
      </RoundedBox>
      <mesh position={[0, -0.87, 0.029]}>
        <planeGeometry args={[0.085, 0.7]} />
        <meshBasicMaterial color={colors.edge} />
      </mesh>
    </>
  );
}

const Paddle = forwardRef(function Paddle({ paddle }, ref) {
  const group = useRef(null);
  const ring = useRef(null);
  const glow = useRef(null);
  const face = useMemo(() => makePaddleFaceMaterial(paddle), [paddle]);
  const glowTexture = useMemo(() => makeGlowTexture(paddle.colors.glowRGB), [paddle.colors.glowRGB]);

  useEffect(() => () => face.dispose(), [face]);
  useImperativeHandle(ref, () => ({ group, ring, glow, face }), [face]);

  return (
    <group ref={group}>
      <PaddleGeometry faceMat={face} paddle={paddle} />
      <sprite ref={ring} position={[0, 0, 0.02]} scale={[1.6, 1.6, 1]}>
        <spriteMaterial map={glowTexture} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      <sprite ref={glow} scale={[1.9, 1.9, 1]}>
        <spriteMaterial map={glowTexture} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
    </group>
  );
});

function trailSignature(config) {
  return `${config.length}|${config.decay}|${config.local}|${config.stride}|${config.interval}`;
}
function trailAttenuation(value) {
  return value ** TUNING.ballTrail.attenuationPower;
}

const Ball = forwardRef(function Ball({ extraFx }, ref) {
  const group = useRef(null);
  const mesh = useRef(null);
  const trail = useRef(null);
  const signature = useRef(trailSignature(TUNING.ballTrail));
  const phase = useRef(useGameStore.getState().phase);
  const [version, bumpVersion] = useState(0);

  useImperativeHandle(ref, () => ({ group, mesh, trail }), []);

  useFrame(() => {
    const config = TUNING.ballTrail;
    const mat = trail.current?.material;
    if (mat) {
      mat.lineWidth = config.width * 0.1;
      mat.color.set(config.color);
    }
    const nextSignature = trailSignature(config);
    if (nextSignature !== signature.current) {
      signature.current = nextSignature;
      bumpVersion((value) => value + 1);
    }
    const nextPhase = useGameStore.getState().phase;
    if ((phase.current === 'serve') !== (nextPhase === 'serve')) bumpVersion((value) => value + 1);
    phase.current = nextPhase;
  });

  const config = TUNING.ballTrail;
  const ballMesh = (
    <mesh ref={mesh}>
      <sphereGeometry args={[TABLE.ballRadius, 24, 18]} />
      <meshStandardMaterial color={COLORS.ball} emissive={COLORS.ball} emissiveIntensity={0.22} roughness={0.42} metalness={0} />
    </mesh>
  );
  if (!extraFx) return <group ref={group}>{ballMesh}</group>;

  return (
    <group ref={group}>
      <Trail
        key={version}
        ref={trail}
        width={config.width}
        length={config.length}
        color={config.color}
        decay={config.decay}
        attenuation={trailAttenuation}
        local={config.local}
        stride={config.stride}
        interval={config.interval}
      >
        {ballMesh}
      </Trail>
    </group>
  );
});

function makeNetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 456;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(252,248,240,0.55)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= canvas.width; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.width, y + 0.5);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.minFilter = texture.magFilter = NearestFilter;
  return texture;
}

const netWidth = TABLE.halfWidth * 2;
const netDepth = 0.045;
const postX = TABLE.halfWidth + 0.08;
const topBarWidth = TABLE.halfWidth * 2 + 0.16;

const Net = forwardRef(function Net(_props, ref) {
  const cloth = useRef(null);
  const bars = useRef([]);
  const posts = useRef([]);
  const texture = useMemo(makeNetTexture, []);

  useEffect(() => {
    const { color, opacity } = TUNING.net;
    if (cloth.current) {
      cloth.current.opacity = opacity;
      cloth.current.color.set(color);
    }
    for (const material of bars.current) material?.color.set(color);
    for (const material of posts.current) material?.color.set(color);
  }, []);

  return (
    <group ref={ref}>
      <mesh position={[0, TABLE.netHeight / 2, 0]}>
        <boxGeometry args={[netWidth, TABLE.netHeight, netDepth]} />
        <meshBasicMaterial ref={cloth} map={texture} color={TUNING.net.color} transparent opacity={TUNING.net.opacity} depthWrite={false} side={DoubleSide} />
      </mesh>
      <mesh position={[0, TABLE.netHeight, 0]}>
        <boxGeometry args={[topBarWidth, 0.06, 0.04]} />
        <meshStandardMaterial ref={(node) => { bars.current[0] = node; }} color={TUNING.net.color} roughness={0.55} metalness={0} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * postX, (TABLE.netHeight + 0.04) / 2, 0]}>
          <cylinderGeometry args={[0.05, 0.055, TABLE.netHeight + 0.04, 18]} />
          <meshStandardMaterial ref={(node) => { posts.current[side < 0 ? 0 : 1] = node; }} color={TUNING.net.color} roughness={0.6} metalness={0} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`cap-${side}`} position={[side * postX, TABLE.netHeight + 0.04, 0]}>
          <sphereGeometry args={[0.06, 18, 12]} />
          <meshStandardMaterial ref={(node) => { posts.current[side < 0 ? 2 : 3] = node; }} color={TUNING.net.color} roughness={0.55} metalness={0} />
        </mesh>
      ))}
    </group>
  );
});

const randomBetween = (min, max) => min + Math.random() * (max - min);
const scoreTextCount = 4;
const ringCount = perfSettings.ringCount;
const shockCount = perfSettings.shockCount;
const impactCount = perfSettings.impactCount;
const confettiCount = perfSettings.confettiCount;
const confettiColors = ['#d9665f', '#fff3dc', '#de7a6d', '#c85f59', '#ef8f87', '#a8b598'];

const Effects = forwardRef(function Effects({ enabled }, ref) {
  const { camera } = useThree();
  const glowTexture = useMemo(() => makeGlowTexture('255,238,210'), []);
  const ringTexture = useMemo(() => makeRingTexture('255,236,196'), []);
  const rings = useRef([]);
  const shocks = useRef([]);
  const impacts = useRef([]);
  const scoreTexts = useRef([]);
  const confetti = useRef(null);
  const temp = useMemo(() => new Object3D(), []);
  const confettiPalette = useMemo(() => confettiColors.map((color) => new Color(color)), []);
  const ringState = useMemo(() => Array.from({ length: ringCount }, () => ({ life: 0 })), []);
  const shockState = useMemo(() => Array.from({ length: shockCount }, () => ({ life: 0, max: 1, to: 1 })), []);
  const impactState = useMemo(() => Array.from({ length: impactCount }, () => ({ life: 0, max: 1, to: 1 })), []);
  const scoreTextState = useMemo(() => Array.from({ length: scoreTextCount }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0 })), []);
  const confettiState = useMemo(() => Array.from({ length: confettiCount }, () => ({
    life: 0, max: 1, dead: true, landed: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, w: 0, swf: 3, sc: 1,
  })), []);

  useEffect(() => {
    const mesh = confetti.current;
    if (!mesh) return;
    temp.position.set(0, -10, 0);
    temp.rotation.set(0, 0, 0);
    temp.scale.set(0, 0, 0);
    temp.updateMatrix();
    for (let i = 0; i < confettiCount; i += 1) mesh.setMatrixAt(i, temp.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }, [temp]);

  useImperativeHandle(ref, () => ({
    ring(x, z) {
      if (!enabled) return;
      for (let i = 0; i < ringCount; i += 1) {
        if (ringState[i].life > 0) continue;
        ringState[i].life = 0.5;
        rings.current[i]?.position.set(x, 0.02, z);
        return;
      }
    },
    shock(x, y, z, color, to = 1.8) {
      if (!enabled) return;
      for (let i = 0; i < shockCount; i += 1) {
        if (shockState[i].life > 0) continue;
        shockState[i].life = shockState[i].max = 0.5;
        shockState[i].to = to;
        const sprite = shocks.current[i];
        if (sprite) {
          sprite.position.set(x, y, z);
          sprite.material.color.set(color);
          sprite.material.opacity = 0.9;
          sprite.scale.set(0.3, 0.3, 1);
        }
        return;
      }
    },
    impact(x, y, z, color, power = 0.6) {
      if (!enabled) return;
      for (let i = 0; i < impactCount; i += 1) {
        if (impactState[i].life > 0) continue;
        impactState[i].life = impactState[i].max = 0.26;
        impactState[i].to = 1.4 + power * 2.6;
        const sprite = impacts.current[i];
        if (sprite) {
          sprite.position.set(x, y, z);
          sprite.material.color.set(color);
          sprite.material.opacity = 0.95;
          sprite.scale.set(0.4, 0.4, 1);
        }
        return;
      }
    },
    scoreText(x, y, z, color, label = '+1') {
      if (!enabled) return;
      for (let i = 0; i < scoreTextCount; i += 1) {
        const state = scoreTextState[i];
        if (state.life > 0) continue;
        state.life = state.max = 0.9;
        state.x = x;
        state.y = y + 0.55;
        state.z = z;
        state.vx = randomBetween(-0.35, 0.35);
        const node = scoreTexts.current[i];
        if (node) {
          node.text = label;
          node.color = color;
          node.outlineColor = '#fff3dc';
          node.fillOpacity = 1;
          node.outlineOpacity = 0.75;
          node.visible = true;
          node.position.set(state.x, state.y, state.z);
          node.scale.setScalar(0.65);
        }
        return;
      }
    },
    confetti(x, y, z, count = 48, speed = 2.8) {
      if (!enabled) return;
      const mesh = confetti.current;
      if (!mesh) return;
      count = Math.max(1, Math.round(count * perfSettings.fxScale));
      let emitted = 0;
      for (let i = 0; i < confettiCount && emitted < count; i += 1) {
        const state = confettiState[i];
        if (state.life > 0) continue;
        state.life = state.max = randomBetween(2.2, 3.6);
        state.dead = false;
        state.landed = false;
        state.x = x + randomBetween(-0.5, 0.5);
        state.y = y + randomBetween(-0.2, 0.2);
        state.z = z + randomBetween(-0.5, 0.5);
        state.vx = randomBetween(-speed, speed);
        state.vy = randomBetween(1, 3.2);
        state.vz = randomBetween(-speed, speed);
        state.rx = randomBetween(0, Math.PI * 2);
        state.ry = randomBetween(0, Math.PI * 2);
        state.rz = randomBetween(0, Math.PI * 2);
        state.sx = randomBetween(-8, 8);
        state.sy = randomBetween(-8, 8);
        state.sz = randomBetween(-8, 8);
        state.w = randomBetween(0, Math.PI * 2);
        state.swf = randomBetween(2.2, 4.4);
        state.sc = randomBetween(0.7, 1.3);
        mesh.setColorAt(i, confettiPalette[Math.floor(randomBetween(0, confettiPalette.length)) % confettiPalette.length]);
        emitted += 1;
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  }), [confettiPalette, confettiState, enabled, impactState, ringState, scoreTextState, shockState]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const dt = clampDt(delta);
    for (let i = 0; i < ringCount; i += 1) {
      const state = ringState[i];
      const mesh = rings.current[i];
      if (!mesh) continue;
      if (state.life <= 0) { if (mesh.material.opacity !== 0) mesh.material.opacity = 0; continue; }
      state.life -= dt;
      const t = 1 - state.life / 0.5;
      const scale = 0.3 + t * 1.7;
      mesh.scale.set(scale, scale, scale);
      mesh.material.opacity = (1 - t) * 0.5;
    }
    for (let i = 0; i < shockCount; i += 1) {
      const state = shockState[i];
      const sprite = shocks.current[i];
      if (!sprite) continue;
      if (state.life <= 0) { if (sprite.material.opacity !== 0) sprite.material.opacity = 0; continue; }
      state.life -= dt;
      const t = 1 - state.life / state.max;
      const scale = 0.3 + t * state.to;
      sprite.scale.set(scale, scale, 1);
      sprite.material.opacity = (1 - t) * 0.9;
    }
    for (let i = 0; i < impactCount; i += 1) {
      const state = impactState[i];
      const sprite = impacts.current[i];
      if (!sprite) continue;
      if (state.life <= 0) { if (sprite.material.opacity !== 0) sprite.material.opacity = 0; continue; }
      state.life -= dt;
      const t = 1 - state.life / state.max;
      const scale = 0.4 + t * state.to;
      sprite.scale.set(scale, scale, 1);
      sprite.material.opacity = (1 - t * t) * 0.95;
    }
    for (let i = 0; i < scoreTextCount; i += 1) {
      const state = scoreTextState[i];
      const node = scoreTexts.current[i];
      if (!node) continue;
      if (state.life <= 0) { if (node.visible) node.visible = false; continue; }
      state.life -= dt;
      const t = 1 - state.life / state.max;
      node.position.set(state.x + state.vx * t, state.y + t * 1.05, state.z);
      node.quaternion.copy(camera.quaternion);
      node.scale.setScalar(0.55 + Math.sin(Math.min(1, t) * Math.PI) * 0.22);
      const opacity = Math.max(0, 1 - t * t);
      node.fillOpacity = opacity;
      node.outlineOpacity = opacity * 0.75;
    }

    const mesh = confetti.current;
    if (!mesh) return;
    let dirty = false;
    for (let i = 0; i < confettiCount; i += 1) {
      const state = confettiState[i];
      if (state.life <= 0) {
        if (!state.dead) {
          state.dead = true;
          temp.position.set(0, -10, 0);
          temp.scale.set(0, 0, 0);
          temp.updateMatrix();
          mesh.setMatrixAt(i, temp.matrix);
          dirty = true;
        }
        continue;
      }
      state.life -= dt;
      if (state.landed) {
        const target = Math.round((state.rx - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
        const ease = Math.min(1, dt * 9);
        state.rx += (target - state.rx) * ease;
        state.ry += -state.ry * ease * 0.4;
        state.rz += state.sz * dt * 0.18;
      } else {
        const drag = Math.exp(dt * -1.9);
        state.vx *= drag;
        state.vz *= drag;
        state.vy = Math.max(state.vy - dt * 5.2, -1.75);
        state.x += (state.vx + Math.sin((state.max - state.life) * state.swf + state.w) * 0.6) * dt;
        state.y += state.vy * dt;
        state.z += state.vz * dt;
        state.rx += state.sx * dt;
        state.ry += state.sy * dt;
        state.rz += state.sz * dt;
        const floor = Math.abs(state.x) < TABLE.halfWidth && Math.abs(state.z) < TABLE.halfLength ? 0.025 : -2.1;
        if (state.y <= floor && state.vy < 0) {
          state.y = floor;
          state.landed = true;
          state.life = Math.min(state.life, randomBetween(0.7, 1.5));
        }
      }
      const alphaScale = Math.min(1, state.life / 0.45);
      temp.position.set(state.x, state.y, state.z);
      temp.rotation.set(state.rx, state.ry, state.rz);
      temp.scale.set(state.sc * alphaScale, state.sc * alphaScale, 1);
      temp.updateMatrix();
      mesh.setMatrixAt(i, temp.matrix);
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  });

  if (!enabled) return null;

  return (
    <group>
      {ringState.map((_, index) => (
        <mesh key={`r${index}`} ref={(node) => { rings.current[index] = node; }} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.32, 0.45, 44]} />
          <meshBasicMaterial color="#f3d9a0" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {shockState.map((_, index) => (
        <sprite key={`k${index}`} ref={(node) => { shocks.current[index] = node; }} scale={[0.3, 0.3, 1]}>
          <spriteMaterial map={ringTexture} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
      {impactState.map((_, index) => (
        <sprite key={`i${index}`} ref={(node) => { impacts.current[index] = node; }} scale={[0.4, 0.4, 1]}>
          <spriteMaterial map={glowTexture} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
      {scoreTextState.map((_, index) => (
        <Text
          key={`score-text-${index}`}
          ref={(node) => { scoreTexts.current[index] = node; }}
          font={MONTSERRAT_FONT_URL}
          fontSize={0.7}
          fontWeight={900}
          anchorX="center"
          anchorY="middle"
          color={COLORS.player}
          outlineColor="#fff3dc"
          outlineWidth="4%"
          outlineBlur="2%"
          fillOpacity={0}
          outlineOpacity={0}
          renderOrder={8}
          depthOffset={-8}
          visible={false}
        >
          +1
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </Text>
      ))}
      <instancedMesh ref={confetti} args={[undefined, undefined, confettiCount]} frustumCulled={false}>
        <planeGeometry args={[0.085, 0.13]} />
        <meshBasicMaterial side={DoubleSide} />
      </instancedMesh>
    </group>
  );
});

function shouldHideCursor() {
  const { started, menuOpen, phase } = useGameStore.getState();
  return started && !menuOpen && phase !== 'over' && !DEBUG_MODE;
}
function preventDefault(event) {
  event.preventDefault();
}
function setCursor(element, value) {
  element.style.cursor = value;
}

const targetAspect = 16 / 9;
const maxFov = 70;
const maxScale = 1.3;
function updateCamera(camera, engine) {
  const aspect = camera.aspect;
  let fov = engine.camFov;
  let scale = 1;
  if (aspect < targetAspect) {
    const tan = Math.tan((engine.camFov * Math.PI) / 360) * targetAspect;
    fov = Math.min(maxFov, (Math.atan(tan / aspect) * 360) / Math.PI);
    scale = Math.min(maxScale, tan / (Math.tan((fov * Math.PI) / 360) * aspect));
  }
  camera.position.set(
    engine.camLX + (engine.camX - engine.camLX) * scale,
    engine.camLY + (engine.camY - engine.camLY) * scale,
    engine.camLZ + (engine.camZ - engine.camLZ) * scale,
  );
  camera.lookAt(engine.camLX, engine.camLY, engine.camLZ);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

export function Actors() {
  const { camera, gl } = useThree();
  const player = useRef(null);
  const ai = useRef(null);
  const ball = useRef(null);
  const net = useRef(null);
  const effects = useRef(null);
  const shadow = useRef(null);
  const marker = useRef(null);
  const markerKick = useRef(null);
  const markerArrow = useRef(null);
  const markerSpin = useRef(null);
  const markerSmash = useRef(null);
  const aimMarker = useRef(null);
  const aimPulse = useRef(null);
  const aimSpin = useRef(null);
  const visibleGroup = useRef(null);
  const visibleAmount = useRef(Number(DEBUG_MODE));
  const trailAmount = useRef(0);
  const phase = useRef('serve');
  const shadowTexture = useMemo(() => makeGlowTexture('70,58,38', true), []);
  const resetNonce = useGameStore((state) => state.resetNonce);
  const extraFx = useGameStore((state) => state.performancePrefs.extraFx);
  const mode = useGameStore((state) => state.mode);

  useEffect(() => {
    const element = gl.domElement;
    let exitingPointerLock = false;
    const refreshCursor = () => {
      const hidden = shouldHideCursor();
      inputHud.cursorVisible = hidden;
      setCursor(element, hidden ? 'none' : '');
    };
    const exitPointerLock = () => {
      if (document.pointerLockElement === element) {
        exitingPointerLock = true;
        document.exitPointerLock();
      }
    };
    const currentGame = () => (useGameStore.getState().mode === 'online' ? networkGame : game);
    const onMove = (event) => currentGame().onPointerMove(event);
    const onDown = (event) => {
      currentGame().onPointerDown(event);
      if (event.pointerType === 'mouse' && shouldHideCursor() && document.pointerLockElement !== element) {
        element.requestPointerLock();
      }
    };
    const onUp = (event) => currentGame().onPointerUp(event);
    const onKeyDown = (event) => {
      if (event.code === 'Escape') {
        const state = useGameStore.getState();
        if (!state.started || state.phase === 'over') return;
        if (state.menuOpen) state.closeMenu();
        else state.openMenu();
        return;
      }
      currentGame().onKeyDown(event);
    };
    const onKeyUp = (event) => currentGame().onKeyUp(event);
    const onLockChange = () => {
      const locked = document.pointerLockElement === element;
      currentGame().setPointerLocked(locked);
      if (!locked && !exitingPointerLock) {
        const state = useGameStore.getState();
        if (state.started && !state.menuOpen && state.phase !== 'over') state.openMenu();
      }
      exitingPointerLock = false;
      refreshCursor();
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('contextmenu', preventDefault);
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    refreshCursor();
    const unsubscribe = useGameStore.subscribe(() => {
      if (!shouldHideCursor()) exitPointerLock();
      refreshCursor();
    });
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      unsubscribe();
      if (document.pointerLockElement === element) document.exitPointerLock();
      game.setPointerLocked(false);
      networkGame.setPointerLocked(false);
      inputHud.cursorVisible = false;
      setCursor(element, '');
    };
  }, [gl.domElement]);

  useEffect(() => {
    if (mode !== 'online') game.newMatch();
  }, [resetNonce, mode]);

  useFrame((state, delta) => {
    const store = useGameStore.getState();
    const activeGame = store.mode === 'online' ? networkGame : game;
    activeGame.update(delta, getDebugTime(state.clock.elapsedTime), camera, effects.current);

    const now = getDebugTime(state.clock.elapsedTime);
    const nextStore = useGameStore.getState();
    const attract = nextStore.revealed && !nextStore.started && nextStore.mode === 'offline';
    const active = DEBUG_MODE || nextStore.started || attract;
    const fade = visibleAmount.current = damp(visibleAmount.current, Number(active), active ? 7 : 12, clampDt(delta));
    if (visibleGroup.current) visibleGroup.current.visible = fade > 0.01;
    const scale = Math.max(0.001, fade);

    if (player.current?.group.current) {
      const mesh = player.current.group.current;
      const source = activeGame.player;
      mesh.scale.setScalar(scale);
      mesh.position.set(source.x, source.y, source.z);
      mesh.rotation.x = source.rotX;
      mesh.rotation.z = source.rotZ;
      const uniforms = player.current.face.uniforms;
      uniforms.uTime.value = now;
      uniforms.uHit.value = source.flash;
      uniforms.uCharge.value = inputHud.charge;
      uniforms.uEnergy.value = arenaFx.heat * 0.5;
      player.current.glow.current.material.opacity = source.flash * 0.55;
      player.current.ring.current.material.opacity = inputHud.charge * 0.5;
      const ringScale = 1.5 + inputHud.charge * 0.7 + Math.sin(now * 10) * inputHud.charge * 0.06;
      player.current.ring.current.scale.set(ringScale, ringScale, 1);
    }

    if (ai.current?.group.current) {
      const mesh = ai.current.group.current;
      const source = activeGame.ai;
      mesh.scale.setScalar(scale);
      mesh.position.set(source.x, source.y, source.z);
      mesh.rotation.x = source.rotX;
      mesh.rotation.z = source.rotZ;
      const energy = Math.max(0, activeGame.brain.confidence - 0.5);
      const uniforms = ai.current.face.uniforms;
      uniforms.uTime.value = now;
      uniforms.uHit.value = source.flash;
      uniforms.uCharge.value = source.tell;
      uniforms.uEnergy.value = energy * 0.7;
      ai.current.glow.current.material.opacity = source.flash * 0.55;
      ai.current.ring.current.material.opacity = source.tell * 0.5;
      const ringScale = 1.5 + source.tell * 0.7 + Math.sin(now * 10) * source.tell * 0.06;
      ai.current.ring.current.scale.set(ringScale, ringScale, 1);
    }

    if (ball.current?.group.current) {
      ball.current.group.current.scale.setScalar(scale);
      ball.current.group.current.position.copy(activeGame.ball);
      ball.current.mesh.current.rotation.x = activeGame.ballRotX;
      ball.current.mesh.current.rotation.y = activeGame.ballRotY;
      const speed = activeGame.vel.length();
      ball.current.mesh.current.material.emissiveIntensity = 0.22 + Math.min(speed / 26, 1) * 0.55;
      const currentPhase = useGameStore.getState().phase;
      const serving = currentPhase === 'serve';
      if (serving !== (phase.current === 'serve')) trailAmount.current = 0;
      phase.current = currentPhase;
      const showTrail = active && fade > 0.95 && !serving;
      const trailFade = trailAmount.current = damp(trailAmount.current, Number(showTrail), showTrail ? 9 : 16, clampDt(delta));
      if (ball.current.trail.current) {
        ball.current.trail.current.visible = trailFade > 0.002 || showTrail;
        const material = ball.current.trail.current.material;
        if (material) {
          material.transparent = true;
          material.depthWrite = false;
          material.opacity = trailFade;
        }
      }
    }

    if (shadow.current) {
      shadow.current.position.set(activeGame.shadow.x, 0.02, activeGame.shadow.z);
      shadow.current.material.opacity = activeGame.shadow.op * fade;
      shadow.current.scale.set(activeGame.shadow.scale, activeGame.shadow.scale, 1);
    }
    if (marker.current) {
      marker.current.position.set(activeGame.marker.x, 0.03, activeGame.marker.z);
      marker.current.material.opacity = activeGame.marker.op * fade;
    }
    if (markerKick.current) {
      markerKick.current.position.set(activeGame.marker.kickX, 0.034, activeGame.marker.kickZ);
      markerKick.current.material.opacity = activeGame.marker.op * activeGame.marker.spin * fade * 0.9;
      const kickScale = 0.8 + activeGame.marker.spin * 0.45;
      markerKick.current.scale.set(kickScale, kickScale, 1);
    }
    if (markerArrow.current) {
      const dx = activeGame.marker.kickX - activeGame.marker.x;
      const dz = activeGame.marker.kickZ - activeGame.marker.z;
      const distance = Math.hypot(dx, dz);
      markerArrow.current.position.set(activeGame.marker.x + dx * 0.5, 0.036, activeGame.marker.z + dz * 0.5);
      markerArrow.current.scale.set(1, Math.max(0.001, distance), 1);
      if (distance > 0.001) markerArrow.current.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dx, 0, dz).normalize());
      markerArrow.current.material.opacity = activeGame.marker.op * activeGame.marker.spin * fade * 0.75;
    }
    if (markerSpin.current) {
      markerSpin.current.position.set(activeGame.marker.x, 0.038, activeGame.marker.z);
      markerSpin.current.rotation.z = now * (2.8 + activeGame.marker.spin * 5) * (activeGame.marker.side < 0 ? -1 : 1);
      markerSpin.current.material.opacity = activeGame.marker.op * Math.max(activeGame.marker.spin, 0.35) * fade;
      const spinScale = 1 + activeGame.marker.spin * 0.5;
      markerSpin.current.scale.set(spinScale, spinScale, 1);
    }
    if (markerSmash.current) {
      markerSmash.current.position.set(activeGame.marker.x, 0.04, activeGame.marker.z);
      markerSmash.current.material.opacity = activeGame.marker.op * activeGame.marker.smash * fade * (0.7 + Math.sin(now * 18) * 0.25);
      const smashScale = 1.1 + activeGame.marker.smash * 0.6 + Math.sin(now * 18) * 0.08;
      markerSmash.current.scale.set(smashScale, smashScale, 1);
    }
    if (aimMarker.current) {
      const aim = activeGame.aim || { x: 0, z: 0, op: 0, spinX: 0, spinY: 0, power: 0 };
      aimMarker.current.position.set(aim.x, 0.048, aim.z);
      aimMarker.current.material.opacity = aim.op * fade;
      const aimScale = 0.85 + aim.power * 0.5;
      aimMarker.current.scale.set(aimScale, aimScale, 1);
      aimPulse.current.position.set(aim.x, 0.049, aim.z);
      aimPulse.current.material.opacity = aim.op * fade * (0.45 + Math.sin(now * 12) * 0.18);
      aimPulse.current.scale.set(aimScale * (1.15 + aim.power * 0.35), aimScale * (1.15 + aim.power * 0.35), 1);
      const spinMag = Math.min(1, Math.hypot(aim.spinX, aim.spinY));
      aimSpin.current.position.set(aim.x + aim.spinX * 0.45, 0.052, aim.z - aim.spinY * 0.45);
      aimSpin.current.material.opacity = aim.op * spinMag * fade;
      const spinScale = 0.5 + spinMag * 0.7;
      aimSpin.current.scale.set(spinScale, spinScale, 1);
    }
    if (net.current) net.current.rotation.x = activeGame.netRotX;

    updateCamera(camera, activeGame);
  });

  return (
    <group>
      <group ref={visibleGroup} visible={DEBUG_MODE}>
        <Paddle ref={player} paddle={PLAYER_PADDLE} />
        <Paddle ref={ai} paddle={CPU_PADDLE} />
        <Ball ref={ball} extraFx={extraFx} />
        <sprite ref={shadow} position={[0, 0.02, 0]} scale={[0.6, 0.6, 1]}>
          <spriteMaterial map={shadowTexture} transparent opacity={0} blending={NormalBlending} depthWrite={false} />
        </sprite>
        <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.34, 0.42, 40]} />
          <meshBasicMaterial color={COLORS.player} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={markerKick} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.034, 0]}>
          <ringGeometry args={[0.16, 0.22, 28]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={markerArrow} position={[0, 0.036, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 1, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={markerSpin} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.038, 0]}>
          <ringGeometry args={[0.48, 0.51, 48, 1, 0, Math.PI * 1.55]} />
          <meshBasicMaterial color="#ef8f87" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={markerSmash} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.56, 0.62, 56]} />
          <meshBasicMaterial color={COLORS.ai} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={aimMarker} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.048, 0]}>
          <ringGeometry args={[0.26, 0.34, 44]} />
          <meshBasicMaterial color="#4de6ff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={aimPulse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.049, 0]}>
          <ringGeometry args={[0.42, 0.46, 44]} />
          <meshBasicMaterial color="#4de6ff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh ref={aimSpin} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.052, 0]}>
          <ringGeometry args={[0.1, 0.14, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <Net ref={net} />
      <Effects ref={effects} enabled={extraFx} />
    </group>
  );
}
