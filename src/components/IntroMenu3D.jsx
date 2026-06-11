// Recovered pre-start 3D lobby/menu from production bundle names `aA` + `$k`.
// This is the in-canvas menu layer shown before `started === true`.

import { RoundedBox, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Color } from 'three';
import { BOTS, TUNING } from '../constants.js';
import { getDebugTime } from '../debug-tuning.js';
import { clampDt, damp } from '../fx-state.js';
import { initAudio, playCharge } from '../audio.js';
import { useGameStore } from '../store.js';
import { MONTSERRAT_FONT_URL } from '../fonts.js';

const titleColor = '#fff3e0';
const ink = '#4b4034';
const mutedInk = '#8a7b70';
const accent = '#d9665f';
const card = '#fff4e6';
const outlineWidth = '5%';
const titlePosition = [0, 4.2, -16.4];
const titleTextY = 4.2;
const titleTextZ = -16.4;
const difficultyPosition = [0, 2.5, -2];
const difficultyRotation = [lookRotation(2.5, -2), 0, 0];
const difficultyGap = 1.95;
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
    <Text ref={ref} font={MONTSERRAT_FONT_URL} position={titlePosition} fontSize={3.1} letterSpacing={0.45} anchorX="center" anchorY="middle" color={titleColor} outlineColor="#ffd9a8" outlineBlur="16%" outlineOpacity={0.5} visible={false}>
      BACKSPIN
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
      <Text ref={title} font={MONTSERRAT_FONT_URL} position={[0, 0.4, 0.06]} fontSize={0.14} letterSpacing={0.46} anchorX="center" anchorY="middle" color={mutedInk} outlineColor={mutedInk} outlineWidth={outlineWidth} fillOpacity={0} outlineOpacity={0} renderOrder={5}>
        DIFFICULTY
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </Text>
      {BOTS.map((bot, index) => (
        <group key={bot.id} position={[(index - 1) * difficultyGap, -0.16, 0.06]}>
          <Text ref={(node) => { labels.current[index] = node; }} font={MONTSERRAT_FONT_URL} fontSize={0.32} letterSpacing={0.2} anchorX="center" anchorY="middle" fillOpacity={0} renderOrder={5}>
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
    </group>
  );
}

function IntroMenuInner() {
  const difficulty = useGameStore((state) => state.difficulty);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  const start = useGameStore((state) => state.start);
  const stage = useRef({ t: 0, out: -1, fired: false, lag: 0 });

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


  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        begin();
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
    </group>
  );
}

export function IntroMenu3D() {
  const started = useGameStore((state) => state.started);
  if (started) return null;
  return <IntroMenuInner />;
}
