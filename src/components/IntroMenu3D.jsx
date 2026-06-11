// Recovered pre-start 3D lobby/menu from production bundle names `aA` + `$k`.
// This is the in-canvas menu layer shown before `started === true`.

import { RoundedBox, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AdditiveBlending, CanvasTexture, Color, DoubleSide, ShaderMaterial } from 'three';
import { BOTS, PADDLES, TUNING } from '../constants.js';
import { getDebugTime } from '../debug-tuning.js';
import { clampDt, damp } from '../fx-state.js';
import { initAudio, playCharge } from '../audio.js';
import { useGameStore } from '../store.js';
import { paddleFragmentShader, paddleVertexShader } from '../shaders.js';
import { createPaddleHeadShape, paddleHeadExtrude } from '../paddleShape.js';

const titleColor = '#fff3e0';
const ink = '#4b4034';
const mutedInk = '#8a7b70';
const accent = '#c28e3a';
const card = '#fff4e6';
const outlineWidth = '5%';
const titlePosition = [0, 4.2, -16.4];
const titleTextY = 4.2;
const titleTextZ = -16.4;
const difficultyPosition = [0, 2.5, -2];
const difficultyRotation = [lookRotation(2.5, -2), 0, 0];
const difficultyGap = 1.95;
const paddleSpread = 1.46;
const paddleZ = 2.4;
const paddleY = 1.3112;
const paddleScale = 0.78;
const statsPosition = [0, 0, 5.2];
const statsRotation = [lookRotation(0, 5.2), 0, 0];
const startPosition = [0, -1.05, 5.5];
const startRotation = [lookRotation(-1.05, 5.5), 0, 0];
const statLabels = ['POWER', 'SPEED', 'SPIN', 'CONTROL'];
const statXs = [-0.47, 0.44, 1.35, 2.26];
const inDuration = 0.55;
const outDuration = 0.26;
const startDelay = 0.44;
const revealLag = 1.1;

function lookRotation(y, z) {
  const target = [0, 4.2, 12.3];
  return -Math.atan2(target[1] - y, target[2] - z);
}
function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
function overshoot(value) {
  const t = value - 1;
  return 1 + t * t * (t * 2.9 + 1.9);
}
function stageIn(stage, delay, outDelay) {
  const lag = stage.lag && delay > 0 ? stage.lag : 0;
  let value = overshoot(clamp01((stage.t - delay - lag) / inDuration));
  if (stage.out >= 0) {
    const t = clamp01((stage.t - stage.out - outDelay) / outDuration);
    value *= 1 - t * t * (3 - t * 2);
  }
  return value;
}
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
function makePaddleFaceMaterial(paddle) {
  return new ShaderMaterial({
    defines: { STYLE: paddle.style },
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: new Color('#d7281f') },
      uEdge: { value: new Color('#9f1516') },
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

const paddleHeadShape = createPaddleHeadShape();
const paddleFaceShape = createPaddleHeadShape(0.96);

function MiniPaddle({ faceMat, paddle }) {
  const colors = paddle.colors;
  return (
    <>
      <mesh position={[0, 0, -0.0225]}>
        <extrudeGeometry args={[paddleHeadShape, paddleHeadExtrude]} />
        <meshStandardMaterial color="#8f1d1b" roughness={0.76} metalness={0} />
      </mesh>
      <mesh position={[0, 0, 0.027]}>
        <shapeGeometry args={[paddleFaceShape, 32]} />
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

function GlassCard({ w, h, bgRef, rimRef }) {
  return (
    <group>
      <RoundedBox args={[w + 0.07, h + 0.07, 0.04]} radius={0.2} smoothness={4} position={[0, 0, -0.03]} renderOrder={3}>
        <meshBasicMaterial ref={rimRef} color="#ffffff" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <RoundedBox args={[w, h, 0.05]} radius={0.18} smoothness={4} renderOrder={3}>
        <meshBasicMaterial ref={bgRef} color={card} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </RoundedBox>
    </group>
  );
}

function Title({ stage }) {
  const ref = useRef(null);
  const color = useMemo(() => new Color(), []);
  useFrame((state) => {
    const t = getDebugTime(state.clock.elapsedTime);
    const config = TUNING.menu;
    const amount = clamp01(stageIn(stage.current, 0, 0.16));
    const node = ref.current;
    if (!node) return;
    node.visible = amount > 0.004;
    node.position.y = config.titleY;
    node.fontSize = config.titleSize;
    node.letterSpacing = config.titleTracking;
    node.color = color.set(config.titleColor).multiplyScalar(config.titleBoost);
    node.outlineColor = config.titleGlowColor;
    node.fillOpacity = amount;
    node.outlineOpacity = amount * (config.titleGlow + Math.sin(t * 1.4) * 0.1);
  });
  return (
    <Text ref={ref} position={titlePosition} fontSize={3.1} letterSpacing={0.45} anchorX="center" anchorY="middle" color={titleColor} outlineColor="#ffd9a8" outlineBlur="16%" outlineOpacity={0.5} visible={false}>
      RALLY
      <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
    </Text>
  );
}

function DifficultyPicker({ stage, active, onPick }) {
  const [hover, setHover] = useState(null);
  const group = useRef(null);
  const bg = useRef(null);
  const rim = useRef(null);
  const title = useRef(null);
  const labels = useRef([]);
  const underline = useRef(null);
  const glow = useRef(null);
  const scaleMemory = useRef([1, 1, 1]);
  const glowTexture = useMemo(() => makeGlowTexture('255,245,225'), []);
  const activeIndex = Math.max(0, BOTS.findIndex((bot) => bot.id === active));

  useFrame((_, delta) => {
    const dt = clampDt(delta);
    const raw = stageIn(stage.current, 0.18, 0.12);
    const amount = clamp01(raw);
    const node = group.current;
    if (node) {
      node.visible = raw > 0.004;
      node.position.y = difficultyPosition[1] + (1 - amount) * 0.5;
      node.scale.setScalar(Math.max(0.001, 0.9 + raw * 0.1));
    }
    if (!node?.visible) return;
    if (bg.current) bg.current.opacity = amount * TUNING.menu.glassOpacity;
    if (rim.current) rim.current.opacity = amount * TUNING.menu.glassRim;
    if (title.current) {
      title.current.fillOpacity = amount * 0.85;
      title.current.outlineOpacity = amount * 0.85;
    }
    labels.current.forEach((label, index) => {
      if (!label) return;
      const selected = index === activeIndex;
      const hot = hover === index;
      const color = selected ? accent : hot ? ink : mutedInk;
      const scale = scaleMemory.current[index] = damp(scaleMemory.current[index], selected ? 1.08 : hot ? 1.04 : 1, 12, dt);
      label.scale.setScalar(scale);
      label.color = color;
      label.fillOpacity = amount;
    });
    const x = (activeIndex - 1) * difficultyGap;
    if (underline.current) {
      underline.current.position.x = damp(underline.current.position.x, x, 16, dt);
      underline.current.material.opacity = amount;
    }
    if (glow.current) {
      glow.current.position.x = damp(glow.current.position.x, x, 16, dt);
      glow.current.material.opacity = amount * 0.55;
    }
  });

  return (
    <group ref={group} position={difficultyPosition} rotation={difficultyRotation} visible={false}>
      <GlassCard w={5.9} h={1.34} bgRef={bg} rimRef={rim} />
      <sprite ref={glow} position={[0, -0.16, 0.03]} scale={[1.9, 1, 1]} renderOrder={4}>
        <spriteMaterial map={glowTexture} transparent opacity={0} depthWrite={false} />
      </sprite>
      <Text ref={title} position={[0, 0.4, 0.06]} fontSize={0.14} letterSpacing={0.46} anchorX="center" anchorY="middle" color={mutedInk} outlineColor={mutedInk} outlineWidth={outlineWidth} fillOpacity={0} outlineOpacity={0} renderOrder={5}>
        DIFFICULTY
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </Text>
      {BOTS.map((bot, index) => (
        <group key={bot.id} position={[(index - 1) * difficultyGap, -0.16, 0.06]}>
          <Text ref={(node) => { labels.current[index] = node; }} fontSize={0.32} letterSpacing={0.2} anchorX="center" anchorY="middle" fillOpacity={0} renderOrder={5}>
            {bot.name}
            <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
          </Text>
          <mesh
            position={[0, 0, 0.01]}
            onClick={(event) => { event.stopPropagation(); onPick(bot.id); }}
            onPointerOver={(event) => { event.stopPropagation(); setHover(index); }}
            onPointerOut={() => setHover((value) => (value === index ? null : value))}
          >
            <planeGeometry args={[1.85, 0.85]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={underline} position={[(activeIndex - 1) * difficultyGap, -0.46, 0.07]} renderOrder={5}>
        <planeGeometry args={[1.3, 0.02]} />
        <meshBasicMaterial color={accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PaddleChoice({ paddle, index, stage, selected, onPick }) {
  const [hover, setHover] = useState(false);
  const group = useRef(null);
  const model = useRef(null);
  const glow = useRef(null);
  const anim = useRef({ sel: 0, hov: 0 });
  const face = useMemo(() => makePaddleFaceMaterial(paddle), [paddle]);
  const faceRef = useRef(face);
  const glowTexture = useMemo(() => makeGlowTexture(paddle.colors.glowRGB), [paddle.colors.glowRGB]);
  const x = (index - (PADDLES.length - 1) / 2) * paddleSpread;

  useEffect(() => {
    faceRef.current = face;
    return () => face.dispose();
  }, [face]);

  useFrame((state, delta) => {
    const dt = clampDt(delta);
    const time = getDebugTime(state.clock.elapsedTime);
    const stateRef = anim.current;
    stateRef.sel = damp(stateRef.sel, Number(selected), 10, dt);
    stateRef.hov = damp(stateRef.hov, Number(hover), 12, dt);
    const raw = stageIn(stage.current, 0.3 + index * 0.08, 0.05 + index * 0.035);
    const amount = clamp01(raw);
    if (group.current) group.current.visible = raw > 0.004;
    if (!group.current?.visible) return;
    if (model.current) {
      model.current.position.y = paddleY - (1 - amount) * 1.6 + stateRef.sel * (0.1 + Math.sin(time * 1.3) * 0.045) + stateRef.hov * 0.05;
      model.current.scale.setScalar(Math.max(0.001, paddleScale * raw * (1 + stateRef.sel * 0.08 + stateRef.hov * 0.04)));
      model.current.rotation.y = Math.sin(time * 0.55 + index) * (0.08 + stateRef.sel * 0.22);
    }
    const material = faceRef.current;
    material.uniforms.uTime.value = time;
    material.uniforms.uEnergy.value = 0.28 + stateRef.sel * 0.3;
    material.uniforms.uCharge.value = stateRef.sel * (0.4 + Math.sin(time * 1.1) * 0.32);
    if (glow.current) glow.current.opacity = amount * (stateRef.sel * 0.34 + stateRef.hov * 0.12);
  });

  return (
    <group ref={group} position={[x, 0, 0]} visible={false}>
      <group ref={model} position={[0, paddleY, paddleZ]} scale={paddleScale}>
        <MiniPaddle faceMat={face} paddle={paddle} />
      </group>
      <sprite position={[0, 1.5, paddleZ - 0.5]} scale={[2.7, 2.7, 1]}>
        <spriteMaterial ref={glow} map={glowTexture} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh
        position={[0, 1.2, paddleZ + 0.3]}
        onClick={(event) => { event.stopPropagation(); onPick(); }}
        onPointerOver={(event) => { event.stopPropagation(); setHover(true); }}
        onPointerOut={() => setHover(false)}
      >
        <planeGeometry args={[1.36, 2.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function PaddleStats({ stage, paddle }) {
  const group = useRef(null);
  const bg = useRef(null);
  const pulse = useRef(0);
  const values = [paddle.stats.power, paddle.stats.speed, paddle.stats.spin, paddle.stats.control];
  const edge = useMemo(() => new Color(paddle.colors.edge).multiplyScalar(0.85), [paddle.colors.edge]);

  useEffect(() => { pulse.current = 1; }, [paddle]);

  useFrame((_, delta) => {
    const dt = clampDt(delta);
    pulse.current = Math.max(0, pulse.current - dt * 5);
    const raw = stageIn(stage.current, 0.52, 0.06);
    const node = group.current;
    if (node) {
      node.visible = raw > 0.004;
      node.scale.setScalar(Math.max(0.001, raw * (1 + pulse.current * 0.05)));
    }
    if (bg.current) bg.current.opacity = clamp01(raw) * TUNING.menu.cardOpacity;
  });

  return (
    <group ref={group} position={statsPosition} rotation={statsRotation} visible={false}>
      <RoundedBox args={[5.4, 1.1, 0.05]} radius={0.18} smoothness={4} renderOrder={3}>
        <meshBasicMaterial ref={bg} color="#f7eede" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <group position={[0, 0, 0.05]}>
        <Text position={[-1.78, 0.17, 0]} fontSize={0.215} letterSpacing={0.3} anchorX="center" anchorY="middle" color={edge} fillOpacity={1} renderOrder={5}>
          {paddle.name}
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </Text>
        <Text position={[-1.78, -0.17, 0]} fontSize={0.105} letterSpacing={0.04} lineHeight={1.35} maxWidth={1.7} textAlign="center" anchorX="center" anchorY="middle" color={ink} renderOrder={5}>
          {paddle.tag}
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </Text>
        <mesh position={[-0.92, 0, 0]} renderOrder={5}>
          <planeGeometry args={[0.015, 0.66]} />
          <meshBasicMaterial color={ink} transparent opacity={0.16} depthWrite={false} toneMapped={false} />
        </mesh>
        {values.map((value, statIndex) => {
          const filled = Math.min(5, Math.max(1, Math.round(value * 5)));
          return (
            <group key={statLabels[statIndex]} position={[statXs[statIndex], 0, 0]}>
              <Text position={[0, 0.17, 0]} fontSize={0.1} letterSpacing={0.24} anchorX="center" anchorY="middle" color={ink} outlineColor={ink} outlineWidth={outlineWidth} renderOrder={5}>
                {statLabels[statIndex]}
                <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
              </Text>
              {[0, 1, 2, 3, 4].map((dot) => (
                <group key={dot} position={[(dot - 2) * 0.135, -0.14, 0]}>
                  <mesh renderOrder={5} visible={dot < filled}>
                    <circleGeometry args={[0.05, 24]} />
                    <meshBasicMaterial color={edge} transparent depthWrite={false} toneMapped={false} />
                  </mesh>
                  <mesh renderOrder={5} visible={dot >= filled}>
                    <ringGeometry args={[0.037, 0.05, 24]} />
                    <meshBasicMaterial color={ink} transparent opacity={0.25} depthWrite={false} toneMapped={false} />
                  </mesh>
                </group>
              ))}
            </group>
          );
        })}
      </group>
    </group>
  );
}

function PaddleHalo({ stage }) {
  const ring = useRef(null);
  const glow = useRef(null);
  const state = useRef({ x: 0, init: false });
  const texture = useMemo(() => makeGlowTexture('255,255,255'), []);

  useFrame((clock, delta) => {
    const dt = clampDt(delta);
    const time = getDebugTime(clock.clock.elapsedTime);
    const { paddle } = useGameStore.getState();
    const index = Math.max(0, PADDLES.findIndex((item) => item.id === paddle));
    const color = PADDLES[index].colors.edge;
    const targetX = (index - (PADDLES.length - 1) / 2) * paddleSpread;
    const memory = state.current;
    if (!memory.init) {
      memory.x = targetX;
      memory.init = true;
    }
    memory.x = damp(memory.x, targetX, 14, dt);
    const amount = clamp01(stageIn(stage.current, 0.46, 0.04));
    if (ring.current) {
      ring.current.visible = amount > 0.004;
      ring.current.position.x = memory.x;
      ring.current.material.color.set(color);
      ring.current.material.opacity = amount * (0.5 + Math.sin(time * 2.2) * 0.1);
      const scale = 1 + (1 - amount) * 0.4;
      ring.current.scale.set(scale, scale, 1);
    }
    if (glow.current) {
      glow.current.visible = amount > 0.004;
      glow.current.position.x = memory.x;
      glow.current.material.color.set(color);
      glow.current.material.opacity = amount * 0.22;
    }
  });

  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, paddleZ]} visible={false}>
        <ringGeometry args={[0.56, 0.64, 64]} />
        <meshBasicMaterial transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, paddleZ]} visible={false}>
        <planeGeometry args={[2.2, 2.2]} />
        <meshBasicMaterial map={texture} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

function StartButton({ stage, onStart }) {
  const [hover, setHover] = useState(false);
  const group = useRef(null);
  const bg = useRef(null);
  const label = useRef(null);
  const hoverMix = useRef(0);
  const colors = useMemo(() => ({ base: new Color(accent), hot: new Color(accent).multiplyScalar(1.16) }), []);

  useFrame((state, delta) => {
    const dt = clampDt(delta);
    const time = getDebugTime(state.clock.elapsedTime);
    const amount = clamp01(stageIn(stage.current, 0.62, 0));
    const node = group.current;
    if (!node) return;
    node.visible = amount > 0.004;
    const hot = hoverMix.current = damp(hoverMix.current, Number(hover), 12, dt);
    const breathe = 1 + Math.sin(time * 2.4) * 0.015 * (1 - hot);
    node.scale.setScalar(Math.max(0.001, (0.92 + amount * 0.08) * (1 + hot * 0.06) * breathe));
    if (bg.current) {
      bg.current.color.copy(colors.base).lerp(colors.hot, hot);
      bg.current.opacity = amount * 0.96;
    }
    if (label.current) {
      label.current.fillOpacity = amount;
      label.current.outlineOpacity = amount;
    }
  });

  return (
    <group
      ref={group}
      position={startPosition}
      rotation={startRotation}
      visible={false}
      onClick={(event) => { event.stopPropagation(); onStart(); }}
      onPointerOver={(event) => { event.stopPropagation(); setHover(true); }}
      onPointerOut={() => setHover(false)}
    >
      <RoundedBox args={[2.6, 0.62, 0.06]} radius={0.29} smoothness={5}>
        <meshBasicMaterial ref={bg} color={accent} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </RoundedBox>
      <Text ref={label} position={[0, 0, 0.07]} fontSize={0.215} letterSpacing={0.3} anchorX="center" anchorY="middle" color="#fff7ea" outlineColor="#fff7ea" outlineWidth="4%" fillOpacity={0} outlineOpacity={0}>
        START
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </Text>
    </group>
  );
}

function IntroMenuInner() {
  const paddleId = useGameStore((state) => state.paddle);
  const difficulty = useGameStore((state) => state.difficulty);
  const setPaddle = useGameStore((state) => state.setPaddle);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  const start = useGameStore((state) => state.start);
  const paddle = PADDLES.find((item) => item.id === paddleId) || PADDLES[0];
  const stage = useRef({ t: 0, out: -1, fired: false, lag: 0 });

  const pickPaddle = (id) => {
    if (stage.current.out >= 0 || !useGameStore.getState().revealed) return;
    initAudio();
    playCharge(0.5);
    setPaddle(id);
  };
  const pickDifficulty = (id) => {
    if (stage.current.out >= 0 || !useGameStore.getState().revealed) return;
    initAudio();
    playCharge(0.7);
    setDifficulty(id);
  };
  const begin = () => {
    if (stage.current.out >= 0 || !useGameStore.getState().revealed) return;
    initAudio();
    playCharge(1);
    stage.current.out = stage.current.t;
  };
  const stepPaddle = (delta) => {
    const index = PADDLES.findIndex((item) => item.id === paddleId);
    pickPaddle(PADDLES[(index + delta + PADDLES.length) % PADDLES.length].id);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        begin();
      } else if (event.code === 'ArrowLeft') {
        stepPaddle(-1);
      } else if (event.code === 'ArrowRight') {
        stepPaddle(1);
      } else if (event.code === 'Digit1') {
        pickDifficulty(BOTS[0].id);
      } else if (event.code === 'Digit2') {
        pickDifficulty(BOTS[1].id);
      } else if (event.code === 'Digit3') {
        pickDifficulty(BOTS[2].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useFrame((_, delta) => {
    const state = stage.current;
    if (!useGameStore.getState().revealed) {
      state.lag = revealLag;
      return;
    }
    state.t += clampDt(delta);
    if (state.out >= 0 && !state.fired && state.t - state.out >= startDelay) {
      state.fired = true;
      start();
    }
  });

  return (
    <group>
      <Title stage={stage} />
      <DifficultyPicker stage={stage} active={difficulty} onPick={pickDifficulty} />
      {PADDLES.map((item, index) => (
        <PaddleChoice key={item.id} paddle={item} index={index} stage={stage} selected={paddleId === item.id} onPick={() => pickPaddle(item.id)} />
      ))}
      <PaddleHalo stage={stage} />
      <PaddleStats stage={stage} paddle={paddle} />
      <StartButton stage={stage} onStart={begin} />
    </group>
  );
}

export function IntroMenu3D() {
  const started = useGameStore((state) => state.started);
  if (started) return null;
  return <IntroMenuInner />;
}
