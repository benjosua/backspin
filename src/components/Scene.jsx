// Recovered render-layer source from production bundle names:
// jT WorldBackground, HT Lights, GT EnvironmentModel, IE ArenaRings, ZE TableModel.

import { useFrame, useThree } from '@react-three/fiber';
import { Text, useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, Color, MeshBasicMaterial, ShaderMaterial } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { arenaFx, clampDt, damp } from '../fx-state.js';
import { useGameStore } from '../store.js';
import { MONTSERRAT_FONT_URL } from '../fonts.js';
import { BOTS, TABLE, TUNING } from '../constants.js';
import { skyFragmentShader, skyVertexShader } from '../shaders.js';
import { getDebugTime } from '../debug-tuning.js';

const ktx2Loader = new KTX2Loader().setTranscoderPath('/basis/');
const tableUrl = '/table-baked.glb';
const environmentUrl = '/environment-baked.glb';

function withKtx2(gl) {
  return (loader) => {
    ktx2Loader.detectSupport(gl);
    loader.setKTX2Loader(ktx2Loader);
  };
}

function cloneBasicScene(scene) {
  const clone = scene.clone(true);
  clone.traverse((node) => {
    if (!node.isMesh) return;
    node.material = new MeshBasicMaterial({ map: node.material?.map ?? null });
    node.castShadow = false;
    node.receiveShadow = false;
  });
  return clone;
}

export function WorldBackground() {
  const { scene } = useThree();

  useEffect(() => {
    scene.background?.set?.(TUNING.world.background);
    if (scene.fog) {
      scene.fog.color.set(TUNING.world.fog);
      scene.fog.density = TUNING.world.fogDensity;
    }
  }, [scene]);

  useFrame(() => {
    scene.background?.set?.(TUNING.world.background);
    if (scene.fog) {
      scene.fog.color.set(TUNING.world.fog);
      scene.fog.density = TUNING.world.fogDensity;
    }
  });

  return (
    <>
      <color attach="background" args={[TUNING.world.background]} />
      <fogExp2 attach="fog" args={[TUNING.world.fog, TUNING.world.fogDensity]} />
    </>
  );
}

const warmKey = new Color('#ffb066');
const pulseKey = new Color('#ffe7c0');
const tmpColor = new Color();

export function Lights() {
  const key = useRef(null);
  const ambient = useRef(null);

  useFrame((_, delta) => {
    const dt = clampDt(delta);
    const { heat, pulse, bounce, smash, score } = arenaFx;
    const flash = Math.max(pulse, bounce * 0.7, smash, score);
    const config = TUNING.lighting;

    if (key.current) {
      key.current.intensity = damp(key.current.intensity, config.key + heat * 0.6 + flash * 1.2, 12, dt);
      tmpColor
        .set(config.keyColor)
        .lerp(warmKey, Math.min(1, heat * 0.6 + smash * 0.5))
        .lerp(pulseKey, flash * 0.5);
      key.current.color.lerp(tmpColor, 1 - Math.exp(dt * -12));
    }

    if (ambient.current) {
      ambient.current.intensity = damp(ambient.current.intensity, config.ambient + heat * 0.12 + flash * 0.22, 12, dt);
      ambient.current.color.set(config.ambColor);
    }
  });

  return (
    <>
      <ambientLight ref={ambient} intensity={TUNING.lighting.ambient} color={TUNING.lighting.ambColor} />
      <directionalLight
        ref={key}
        position={[4.5, 7.5, 5.5]}
        intensity={TUNING.lighting.key}
        color={TUNING.lighting.keyColor}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={2}
        shadow-camera-far={16}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
    </>
  );
}

export function EnvironmentModel() {
  const { gl } = useThree();
  const gltf = useGLTF(environmentUrl, false, false, withKtx2(gl));
  const scene = useMemo(() => cloneBasicScene(gltf.scene), [gltf.scene]);
  return <primitive object={scene} />;
}

const floorY = -2.1;
const shockColor = new Color('#ffce8a');

export function ArenaRings() {
  const ring = useRef(null);
  const ringMaterial = useRef(null);
  const signature = useRef('');
  const shocks = useRef([]);

  useFrame((_, delta) => {
    const dt = clampDt(delta);
    const { heat, pulse, bounce, smash, score } = arenaFx;
    const flash = Math.max(pulse * 0.4, bounce * 0.45, smash, score * 0.75);
    const config = TUNING.background;

    if (ring.current) {
      ring.current.position.y = floorY + config.ringY;
      ring.current.scale.set(config.ringScaleX, config.ringScaleZ, 1);
      const nextSignature = `${config.ringInner}|${config.ringWidth}|${config.ringSegments}`;
      if (nextSignature !== signature.current) {
        signature.current = nextSignature;
        ring.current.geometry.dispose();
        ring.current.geometry = new ring.current.geometry.constructor(
          config.ringInner,
          config.ringInner + config.ringWidth,
          config.ringSegments,
        );
      }
    }

    if (ringMaterial.current) {
      ringMaterial.current.color.set(config.ringColor);
      ringMaterial.current.opacity = damp(
        ringMaterial.current.opacity,
        config.ringOpacity + heat * 0.2 + flash * 0.18,
        8,
        dt,
      );
    }

    const shock = Math.max(smash, score);
    const remainder = 1 - shock;
    for (let i = 0; i < shocks.current.length; i += 1) {
      const mesh = shocks.current[i];
      if (!mesh) continue;
      const scale = 1 + remainder * (4 + i * 3);
      mesh.scale.set(scale, scale, 1);
      mesh.material.opacity = shock * (i === 0 ? 0.45 : 0.28);
    }
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.07, 0]} receiveShadow>
        <planeGeometry args={[14, 16]} />
        <shadowMaterial transparent opacity={0.16} />
      </mesh>

      <mesh
        ref={ring}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, floorY + TUNING.background.ringY, 0]}
        scale={[TUNING.background.ringScaleX, TUNING.background.ringScaleZ, 1]}
      >
        <ringGeometry args={[TUNING.background.ringInner, TUNING.background.ringInner + TUNING.background.ringWidth, TUNING.background.ringSegments]} />
        <meshBasicMaterial
          ref={ringMaterial}
          color={TUNING.background.ringColor}
          transparent
          opacity={TUNING.background.ringOpacity}
          blending={2}
          depthWrite={false}
        />
      </mesh>

      {[0, 1].map((index) => (
        <mesh
          key={`shock${index}`}
          ref={(node) => { shocks.current[index] = node; }}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -2.04, 0]}
        >
          <ringGeometry args={[2.4, 2.78, 90]} />
          <meshBasicMaterial color={shockColor} transparent opacity={0} blending={2} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const tableGlow = new Color('#1689e8');
const tableHot = new Color('#31a7ff');
const tableTmp = new Color();
const tableInset = 0.08;
const tableHalfWidth = TABLE.halfWidth - tableInset;
const tableHalfLength = TABLE.halfLength - tableInset;
const tableLineY = 0.018;
const lineGap = 0.18;
const edgeLineWidth = 0.09;
const centerLineWidth = 0.05;
const lineX = tableHalfWidth - lineGap;
const lineZ = tableHalfLength - lineGap;

function TableLine({ w, d, x, z, matRef }) {
  return (
    <mesh position={[x, tableLineY, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial
        ref={matRef}
        color={TUNING.table.lineColor}
        side={2}
        transparent
        opacity={0.96}
        toneMapped={false}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}

export function TableModel() {
  const glow = useRef(null);
  const lines = useRef([]);
  const { gl } = useThree();
  const gltf = useGLTF(tableUrl, false, false, withKtx2(gl));
  const scene = useMemo(() => cloneBasicScene(gltf.scene), [gltf.scene]);

  useFrame((_, delta) => {
    const dt = clampDt(delta);
    const { heat, pulse, bounce, smash, score } = arenaFx;
    const flash = Math.max(pulse * 0.6, bounce, smash, score * 0.8);
    const config = TUNING.table;

    if (glow.current) {
      const target = Math.min(0.85, config.baseGlow * 0.12 + heat * config.heatGlow * 0.5 + flash * config.flashGlow * 0.5);
      glow.current.opacity = damp(glow.current.opacity, target, 10, dt);
      tableTmp.set(config.emissive).lerp(tableHot.set(config.hot), Math.min(1, heat * 0.7 + smash * 0.5));
      glow.current.color.lerp(tableTmp, 1 - Math.exp(dt * -10));
    }

    const lineOpacity = 0.9 + heat * 0.06 + flash * config.lineGlow * 0.07;
    for (const line of lines.current) {
      if (!line) continue;
      line.color.set(config.lineColor);
      line.opacity = damp(line.opacity, Math.min(1, lineOpacity), 12, dt);
    }
  });

  return (
    <group>
      <primitive object={scene} />
      <mesh position={[0, 0.009, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow renderOrder={0}>
        <planeGeometry args={[(tableHalfWidth - 0.06) * 2, (tableHalfLength - 0.06) * 2]} />
        <shadowMaterial transparent opacity={0.18} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[(tableHalfWidth - 0.06) * 2, (tableHalfLength - 0.06) * 2]} />
        <meshBasicMaterial ref={glow} color={TUNING.table.emissive} transparent opacity={0} depthWrite={false} blending={2} toneMapped={false} />
      </mesh>
      <TableLine w={edgeLineWidth} d={lineZ * 2} x={-lineX} z={0} matRef={(node) => { lines.current[0] = node; }} />
      <TableLine w={edgeLineWidth} d={lineZ * 2} x={lineX} z={0} matRef={(node) => { lines.current[1] = node; }} />
      <TableLine w={lineX * 2} d={edgeLineWidth} x={0} z={-lineZ} matRef={(node) => { lines.current[2] = node; }} />
      <TableLine w={lineX * 2} d={edgeLineWidth} x={0} z={lineZ} matRef={(node) => { lines.current[3] = node; }} />
      <TableLine w={centerLineWidth} d={lineZ * 2} x={0} z={0} matRef={(node) => { lines.current[4] = node; }} />
    </group>
  );
}


const wallZ = -17.15;
const wallH = 12.4;
const wallCenterY = 4;
const digitChars = '0123456789';
const labelChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const roomCodeChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';

function boostedColor(target, color, boost) {
  target.set(color);
  target.r *= boost;
  target.g *= boost;
  target.b *= boost;
  return target;
}
function percent(value) {
  return `${value}%`;
}
function applyScoreText(node, config) {
  const color = node._fill || new Color();
  node._fill = color;
  node.color = boostedColor(color, config.scoreFill, config.scoreFillBoost);
  node.outlineColor = config.scoreGlow;
  node.fillOpacity = config.scoreFillOpacity;
  node.outlineWidth = percent(config.scoreOutlineWidth);
  node.outlineBlur = percent(config.scoreOutlineBlur);
  node.outlineOpacity = config.scoreOutlineOpacity;
  node.fontSize = config.scoreFontSize;
  node.fontWeight = config.scoreFontWeight;
  node.sdfGlyphSize = config.scoreSdfSize;
}
function applyLabelText(node, config, active, letterSpacing = 0) {
  const color = node._fill || new Color();
  node._fill = color;
  node.letterSpacing = letterSpacing;
  node.color = boostedColor(color, active ? config.labelFill : config.labelMuted, config.labelFillBoost);
  node.outlineColor = active ? config.labelGlow : config.labelMutedGlow;
  node.fillOpacity = config.labelFillOpacity;
  node.outlineWidth = percent(config.labelOutlineWidth);
  node.outlineBlur = percent(config.labelOutlineBlur);
  node.outlineOpacity = config.labelOutlineOpacity;
  node.fontSize = config.labelFontSize;
  node.fontWeight = config.labelFontWeight;
  node.sdfGlyphSize = config.labelSdfSize;
}
function positionLabelCoords(playerLabel, cpuLabel, config, y) {
  playerLabel.position.set(-config.scoreX, y, 0);
  cpuLabel.position.set(config.scoreX, y, 0);
}
function applyRoomCodeText(node, config) {
  const color = node._fill || new Color();
  node._fill = color;
  node.color = boostedColor(color, config.roomCodeFill, config.roomCodeFillBoost);
  node.outlineColor = config.roomCodeGlow;
  node.fillOpacity = config.roomCodeFillOpacity;
  node.outlineWidth = percent(config.roomCodeOutlineWidth);
  node.outlineBlur = percent(config.roomCodeOutlineBlur);
  node.outlineOpacity = config.roomCodeOutlineOpacity;
  node.fontSize = config.roomCodeFontSize;
  node.fontWeight = config.roomCodeFontWeight;
  node.letterSpacing = config.roomCodeLetterSpacing;
  node.sdfGlyphSize = config.roomCodeSdfSize;
}

export function WallScoreboard() {
  const started = useGameStore((state) => state.started);
  const scoreP = useGameStore((state) => state.scoreP);
  const scoreAI = useGameStore((state) => state.scoreAI);
  const phase = useGameStore((state) => state.phase);
  const winner = useGameStore((state) => state.winner);
  const difficulty = useGameStore((state) => state.difficulty);
  const mode = useGameStore((state) => state.mode);
  const networkStatus = useGameStore((state) => state.networkStatus);
  const roomCode = useGameStore((state) => state.roomCode);
  const playerName = useGameStore((state) => state.playerName);
  const onlineOpponentName = useGameStore((state) => state.opponentName);
  const bot = useMemo(() => BOTS.find((item) => item.id === difficulty) ?? BOTS[1], [difficulty]);
  const playerLabelText = playerName || 'PLAYER';
  const opponentLabel = mode === 'online' ? (onlineOpponentName || 'OPPONENT') : bot.name;
  const playerScore = useRef(null);
  const cpuScore = useRef(null);
  const playerLabel = useRef(null);
  const cpuLabel = useRef(null);
  const roomCodeText = useRef(null);
  const labelGroup = useRef(null);
  const anim = useRef({ score: 0, side: 0, win: 0, winFlash: 0, prevP: 0, prevAI: 0 });
  const lastServer = useRef(null);

  useEffect(() => {
    const config = TUNING.scoreboard;
    if (playerScore.current) applyScoreText(playerScore.current, config);
    if (cpuScore.current) applyScoreText(cpuScore.current, config);
    if (roomCodeText.current) applyRoomCodeText(roomCodeText.current, config);
    lastServer.current = null;
  }, [scoreP, scoreAI, roomCode]);

  useEffect(() => {
    const state = anim.current;
    if (scoreP > state.prevP) {
      state.score = 1;
      state.side = 1;
    } else if (scoreAI > state.prevAI) {
      state.score = 1;
      state.side = -1;
    }
    state.prevP = scoreP;
    state.prevAI = scoreAI;
  }, [scoreP, scoreAI]);

  useEffect(() => {
    const state = anim.current;
    if (phase === 'over' && winner) {
      state.win = winner === 'player' ? 1 : -1;
      state.winFlash = 1;
    } else if (phase !== 'over') {
      state.win = 0;
    }
  }, [phase, winner]);

  useEffect(() => {
    if (!started) {
      const state = anim.current;
      state.score = 0;
      state.side = 0;
      state.win = 0;
      state.winFlash = 0;
      state.prevP = 0;
      state.prevAI = 0;
    }
  }, [started]);

  useFrame((state, delta) => {
    const dt = clampDt(delta);
    const memory = anim.current;
    memory.score = damp(memory.score, 0, 4.5, dt);
    memory.winFlash = damp(memory.winFlash, 0, 1.6, dt);

    const config = TUNING.scoreboard;
    const scoreY = wallCenterY + (config.boardCY - 0.5) * wallH;
    const scoreZ = wallZ + config.scoreZOffset;
    const labelY = scoreY - config.scoreFontSize * 0.52 - config.labelPad - config.labelFontSize * 0.5;
    const labelZ = scoreZ + 0.012;
    const roomCodeY = scoreY - config.scoreFontSize * 0.52 - config.roomCodePad - config.roomCodeFontSize * 0.5;
    const roomCodeZ = scoreZ + 0.024;
    const { server } = useGameStore.getState();
    const breathe = 1 + Math.sin(getDebugTime(state.clock.elapsedTime) * 0.7) * config.breatheAmp + arenaFx.heat * config.breatheHeat;
    const playerPop = memory.side === 1 ? memory.score : 0;
    const cpuPop = memory.side === -1 ? memory.score : 0;

    if (playerScore.current) {
      playerScore.current.position.set(-config.scoreX, scoreY + playerPop * config.popLift, scoreZ);
      playerScore.current.scale.setScalar(breathe * (1 + playerPop * config.popScale));
    }
    if (cpuScore.current) {
      cpuScore.current.position.set(config.scoreX, scoreY + cpuPop * config.popLift, scoreZ);
      cpuScore.current.scale.setScalar(breathe * (1 + cpuPop * config.popScale));
    }
    if (roomCodeText.current) {
      const showRoomCode = mode === 'online' && networkStatus === 'waiting' && !!roomCode;
      roomCodeText.current.position.set(0, roomCodeY, roomCodeZ);
      roomCodeText.current.scale.setScalar(breathe);
      if (roomCodeText.current.visible !== showRoomCode) roomCodeText.current.visible = showRoomCode;
    }
    if (playerLabel.current && cpuLabel.current) {
      if (lastServer.current !== server) {
        lastServer.current = server;
        applyLabelText(playerLabel.current, config, server === 'player', config.labelYouLetterSpacing);
        applyLabelText(cpuLabel.current, config, server === 'ai', 0);
      }
      positionLabelCoords(playerLabel.current, cpuLabel.current, config, labelY);
    }
    if (labelGroup.current) labelGroup.current.position.z = labelZ;
  });

  return (
    <group frustumCulled={false} visible={started}>
      <Text ref={playerScore} font={MONTSERRAT_FONT_URL} renderOrder={4} anchorX="center" anchorY="middle" characters={digitChars} depthOffset={-4}>
        {String(scoreP).padStart(2, '0')}
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </Text>
      <Text ref={cpuScore} font={MONTSERRAT_FONT_URL} renderOrder={4} anchorX="center" anchorY="middle" characters={digitChars} depthOffset={-4}>
        {String(scoreAI).padStart(2, '0')}
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </Text>
      <Text ref={roomCodeText} font={MONTSERRAT_FONT_URL} renderOrder={6} anchorX="center" anchorY="middle" characters={roomCodeChars} depthOffset={-6} visible={mode === 'online' && networkStatus === 'waiting' && !!roomCode}>
        {`ROOM ${roomCode}`}
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </Text>
      <group ref={labelGroup} position={[0, 0, 0]} renderOrder={5}>
        <Text ref={playerLabel} font={MONTSERRAT_FONT_URL} renderOrder={5} anchorX="center" anchorY="middle" characters={labelChars} depthOffset={-5}>
        {playerLabelText}
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </Text>
        <Text ref={cpuLabel} font={MONTSERRAT_FONT_URL} renderOrder={5} anchorX="center" anchorY="middle" characters={labelChars} depthOffset={-5}>
          {opponentLabel}
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </Text>
      </group>
    </group>
  );
}

export function SkyWall() {
  const phase = useGameStore((state) => state.phase);
  const winner = useGameStore((state) => state.winner);
  const win = useRef(0);
  const winFlash = useRef(0);

  useEffect(() => {
    if (phase === 'over' && winner) {
      win.current = winner === 'player' ? 1 : -1;
      winFlash.current = 1;
    } else if (phase !== 'over') {
      win.current = 0;
    }
  }, [phase, winner]);

  const material = useMemo(() => new ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new Color(TUNING.sky.zenith) },
      uEdge: { value: new Color(TUNING.sky.edge) },
      uHorizon: { value: TUNING.sky.horizon },
      uHeat: { value: 0 },
      uHit: { value: 0 },
      uBounce: { value: 0 },
      uSmash: { value: 0 },
      uPoint: { value: 0 },
      uWin: { value: 0 },
      uWinFlash: { value: 0 },
    },
    depthWrite: true,
    fog: false,
    side: BackSide,
  }), []);

  useFrame((state) => {
    material.uniforms.uTime.value = getDebugTime(state.clock.elapsedTime);
    material.uniforms.uZenith.value.set(TUNING.sky.zenith);
    material.uniforms.uEdge.value.set(TUNING.sky.edge);
    material.uniforms.uHorizon.value = TUNING.sky.horizon;
    material.uniforms.uHeat.value = arenaFx.heat;
    material.uniforms.uHit.value = arenaFx.pulse;
    material.uniforms.uBounce.value = arenaFx.bounce;
    material.uniforms.uSmash.value = arenaFx.smash;
    winFlash.current = damp(winFlash.current, 0, 1.6, 0.016);
    material.uniforms.uPoint.value = arenaFx.score;
    material.uniforms.uWin.value = win.current;
    material.uniforms.uWinFlash.value = winFlash.current;
  });

  return (
    <mesh position={[0, 4, -17.15]} frustumCulled={false}>
      <planeGeometry args={[28.4, 12.4]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
