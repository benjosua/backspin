// Recovered app root from production bundle function `bK`.

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { DEBUG_MODE } from './store.js';
import { CAMERA } from './constants.js';
import { WorldBackground, Lights, EnvironmentModel, ArenaRings, TableModel, SkyWall, WallScoreboard } from './components/Scene.jsx';
import { Actors } from './components/Actors.jsx';
import { IntroMenu3D } from './components/IntroMenu3D.jsx';
import { Hud, IntroOverlay, PointerCursor, ModePicker } from './components/Hud.jsx';
import { Postprocessing } from './components/Postprocessing.jsx';
import { DesktopOnlyGate } from './components/DesktopOnlyGate.jsx';

const maxDpr = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2.5;

export default function App() {
  return (
    <DesktopOnlyGate>
      <div className="app">
      <Canvas
        flat
        shadows
        dpr={[1, maxDpr]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{
          fov: DEBUG_MODE ? 38 : 44,
          position: DEBUG_MODE ? CAMERA.introPosition : CAMERA.desktopPosition,
          near: 0.1,
          far: 120,
        }}
      >
        <WorldBackground />
        <Suspense fallback={null}>
          <Lights />
          <SkyWall />
          <EnvironmentModel />
          <ArenaRings />
          <TableModel />
          <Actors />
          <WallScoreboard />
          <IntroMenu3D />
          <Postprocessing />
          <Preload all />
        </Suspense>
      </Canvas>
      {!DEBUG_MODE && <Hud />}
      {!DEBUG_MODE && <PointerCursor />}
      {!DEBUG_MODE && <ModePicker />}
      {!DEBUG_MODE && <IntroOverlay />}
      </div>
    </DesktopOnlyGate>
  );
}
