// Recovered app root from production bundle function `bK`.

import { Suspense, lazy, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { ACESFilmicToneMapping, PCFShadowMap } from 'three';
import { DEBUG_MODE, useGameStore } from './store.js';
import { CAMERA } from './constants.js';
import { perfSettings, perfHudEnabled } from './performance.js';
import { WorldBackground, Lights, ArenaRings, TableModel, WallScoreboard } from './components/Scene.jsx';
import { Actors } from './components/Actors.jsx';
import { IntroMenu3D } from './components/IntroMenu3D.jsx';
import { Hud, IntroOverlay, PointerCursor, ModePicker } from './components/Hud.jsx';
import { DesktopOnlyGate } from './components/DesktopOnlyGate.jsx';
import { useFrame, useThree } from '@react-three/fiber';

const DebugPanel = DEBUG_MODE ? lazy(() => import('./components/DebugPanel.jsx')) : null;
const renderScaleDpr = { low: 0.9, medium: 1.25, high: 1.75 };


function SceneContent() {
  return (
    <>
      <Lights />
      <ArenaRings />
      <TableModel />
      <Actors />
      <WallScoreboard />
      <IntroMenu3D />
    </>
  );
}

function PerformanceRuntime() {
  const { gl, setDpr } = useThree();
  const renderScale = useGameStore((state) => state.performancePrefs.renderScale);
  const targetDpr = renderScaleDpr[renderScale] || renderScaleDpr.medium;
  const stats = useRef({ frames: 0, sum: 0, dpr: targetDpr, last: 0 });
  const hud = useRef(null);

  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 0.85;
  }, [gl]);

  useEffect(() => {
    stats.current.dpr = targetDpr;
    setDpr(targetDpr);
  }, [setDpr, targetDpr]);

  useEffect(() => {
    if (!perfHudEnabled && !DEBUG_MODE) return undefined;
    const node = document.createElement('div');
    node.style.cssText = [
      'position:fixed',
      'left:10px',
      'top:10px',
      'z-index:20',
      'padding:8px 10px',
      'border-radius:8px',
      'background:rgba(0,0,0,.62)',
      'color:#fff',
      'font:11px/1.35 monospace',
      'pointer-events:none',
      'white-space:pre',
    ].join(';');
    document.body.appendChild(node);
    hud.current = node;
    return () => {
      hud.current = null;
      node.remove();
    };
  }, []);

  useFrame((state, delta) => {
    const data = stats.current;
    data.frames += 1;
    data.sum += delta;

    if (perfSettings.adaptiveDpr && data.frames >= 45) {
      const avg = data.sum / data.frames;
      const slow = avg > 1 / 52;
      const fast = avg < 1 / 70;
      if (slow && data.dpr > perfSettings.minDpr) {
        data.dpr = Math.max(perfSettings.minDpr, data.dpr - 0.15);
        setDpr(data.dpr);
      } else if (fast && data.dpr < targetDpr) {
        data.dpr = Math.min(targetDpr, data.dpr + 0.05);
        setDpr(data.dpr);
      }
      data.frames = 0;
      data.sum = 0;
    }

    if ((DEBUG_MODE || perfHudEnabled) && state.clock.elapsedTime - data.last > 0.5) {
      data.last = state.clock.elapsedTime;
      const info = gl.info;
      const message = `quality=${perfSettings.name} scale=${renderScale}\ndpr=${data.dpr.toFixed(2)} fps=${Math.round(1 / Math.max(delta, 0.001))}\ncalls=${info.render.calls} tris=${info.render.triangles}\ngeoms=${info.memory.geometries} tex=${info.memory.textures}`;
      if (hud.current) hud.current.textContent = message;
      else console.debug(`[perf] ${message.replaceAll('\n', ' ')}`);
    }
  });

  return null;
}

export default function App() {
  const debugRevision = useGameStore((state) => (DEBUG_MODE ? state.debugRevision : 0));
  const performanceRevision = useGameStore((state) => state.performanceRevision);
  const renderScale = useGameStore((state) => state.performancePrefs.renderScale);
  const targetDpr = renderScaleDpr[renderScale] || renderScaleDpr.medium;

  return (
    <DesktopOnlyGate>
      <div className="fixed inset-0 overflow-hidden bg-background">
      <Canvas
        shadows={renderScale !== 'low' ? { type: PCFShadowMap } : false}
        dpr={[0.7, targetDpr]}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false }}
        camera={{
          fov: DEBUG_MODE ? 38 : 44,
          position: DEBUG_MODE ? CAMERA.introPosition : CAMERA.desktopPosition,
          near: 0.1,
          far: 45,
        }}
      >
        <PerformanceRuntime />
        <WorldBackground />
        <Suspense fallback={null}>
          <SceneContent key={`${debugRevision}:${performanceRevision}`} />
          <Preload all />
        </Suspense>
      </Canvas>
      {DEBUG_MODE && DebugPanel && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
      {!DEBUG_MODE && <Hud />}
      {!DEBUG_MODE && <PointerCursor />}
      {!DEBUG_MODE && <ModePicker />}
      {!DEBUG_MODE && <IntroOverlay />}
      </div>
    </DesktopOnlyGate>
  );
}
