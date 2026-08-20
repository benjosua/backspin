// Recovered pre-start 3D lobby/menu from production bundle names `aA` + `$k`.
// This is the in-canvas menu layer shown before `started === true`.

import { Text, Text3D } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Box3, Color, Vector3 } from 'three';
import { TUNING } from '../constants.js';
import { clampDt } from '../fx-state.js';
import { useGameStore } from '../store.js';
import { MONTSERRAT_FONT_URL } from '../fonts.js';
import HELVETIKER_BOLD_FONT_URL from 'three/examples/fonts/helvetiker_bold.typeface.json?url';

const titleColor = TUNING.scoreboard.scoreFill;
const titlePosition = [0, 4.2, -16.4];
const inDuration = 0.28;
const outDuration = 0.16;
const revealLag = 0.15;
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

const titleBounds = new Box3();
const titleCenter = new Vector3();
const labelChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -_';

function ScoreStyleText3D({ children, fontSize, height, bevelSize, color, sideColor, fillRef, sideRef }) {
  const textRef = useRef(null);

  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text?.geometry) return;
    text.geometry.computeBoundingBox();
    titleBounds.copy(text.geometry.boundingBox);
    titleBounds.getCenter(titleCenter);
    text.position.set(-titleCenter.x, -titleCenter.y, 0);
  }, [children, fontSize, height, bevelSize]);

  return (
    <Text3D
      ref={textRef}
      font={HELVETIKER_BOLD_FONT_URL}
      size={fontSize}
      height={height}
      curveSegments={8}
      bevelEnabled
      bevelThickness={bevelSize}
      bevelSize={bevelSize}
      bevelSegments={2}
    >
      {children}
      <meshStandardMaterial ref={fillRef} attach="material-0" color={color} roughness={0.72} metalness={0} transparent opacity={0} />
      <meshStandardMaterial ref={sideRef} attach="material-1" color={sideColor} roughness={0.82} metalness={0} transparent opacity={0} />
    </Text3D>
  );
}

function Title({ stage }) {
  const group = useRef(null);
  const fill = useRef(null);
  const side = useRef(null);
  const color = useMemo(() => new Color(), []);
  useFrame(() => {
    const config = TUNING.menu;
    const scoreConfig = TUNING.scoreboard;
    const amount = clamp01(stageIn(stage.current, 0, 0.16));
    const node = group.current;
    if (!node) return;
    node.visible = amount > 0.004;
    node.position.y = config.titleY;
    node.scale.setScalar(1);
    if (fill.current) {
      fill.current.color.copy(color.set(scoreConfig.scoreFill).multiplyScalar(scoreConfig.scoreFillBoost));
      fill.current.opacity = amount;
    }
    if (side.current) {
      side.current.color.set(scoreConfig.text3dSide);
      side.current.opacity = amount;
    }
  });
  return (
    <group ref={group} position={titlePosition} visible={false} renderOrder={4}>
      <ScoreStyleText3D
        fontSize={TUNING.menu.titleSize}
        height={TUNING.scoreboard.text3dDepth}
        bevelSize={TUNING.scoreboard.text3dBevel}
        color={titleColor}
        sideColor={TUNING.scoreboard.text3dSide}
        fillRef={fill}
        sideRef={side}
      >
        BACKSPIN
      </ScoreStyleText3D>
    </group>
  );
}

function LivePlayersBadge({ stage }) {
  const livePlayerCount = useGameStore((state) => state.livePlayerCount);
  const group = useRef(null);
  const text = useRef(null);
  const color = useMemo(() => new Color(), []);
  const visiblePlayerCount = Math.max(0, Number(livePlayerCount) || 0);
  const label = `${visiblePlayerCount} LIVE ${visiblePlayerCount === 1 ? 'PLAYER' : 'PLAYERS'}`;

  useFrame(() => {
    const config = TUNING.menu;
    const labelConfig = TUNING.scoreboard;
    const amount = clamp01(stageIn(stage.current, 0.1, 0.08));
    const node = group.current;
    if (!node) return;
    node.visible = amount > 0.004;
    node.position.y = config.titleY - 1.78;
    node.scale.setScalar(0.92 + amount * 0.08);
    if (!text.current) return;
    text.current.letterSpacing = labelConfig.labelYouLetterSpacing;
    text.current.color = color.set(labelConfig.labelMuted).multiplyScalar(labelConfig.labelFillBoost);
    text.current.outlineColor = labelConfig.labelMutedGlow;
    text.current.outlineWidth = labelConfig.labelOutlineWidth;
    text.current.outlineBlur = labelConfig.labelOutlineBlur;
    text.current.fillOpacity = amount * labelConfig.labelFillOpacity;
    text.current.outlineOpacity = amount * labelConfig.labelOutlineOpacity;
    text.current.fontSize = labelConfig.labelFontSize;
    text.current.fontWeight = labelConfig.labelFontWeight;
    text.current.sdfGlyphSize = labelConfig.labelSdfSize;
  });

  return (
    <group ref={group} position={titlePosition} visible={false} renderOrder={4}>
      <Text
        ref={text}
        font={MONTSERRAT_FONT_URL}
        position={[0, 0.01, 0]}
        anchorX="center"
        anchorY="middle"
        characters={labelChars}
        depthOffset={-5}
      >
        {label}
        <meshBasicMaterial transparent depthWrite={false} />
      </Text>
    </group>
  );
}

function IntroMenuInner() {
  const stage = useRef({ t: 0, out: -1, fired: false, lag: 0 });

  useFrame((_, delta) => {
    const state = stage.current;
    if (!useGameStore.getState().revealed) {
      state.lag = revealLag;
      return;
    }
    state.t += clampDt(delta);
  });

  return (
    <group>
      <Title stage={stage} />
      <LivePlayersBadge stage={stage} />
    </group>
  );
}

export function IntroMenu3D() {
  const started = useGameStore((state) => state.started);
  if (started) return null;
  return <IntroMenuInner />;
}
