// Recovered app root from production bundle function `bK`.

import { Suspense, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { ACESFilmicToneMapping } from 'three';
import { toast } from 'sonner';
import { useGameStore } from './store.js';
import { CAMERA } from './constants.js';
import { perfSettings, perfHudEnabled } from './performance.js';
import { WorldBackground, Lights, ArenaRings, TableModel, WallScoreboard } from './components/Scene.jsx';
import { Actors } from './components/Actors.jsx';
import { IntroMenu3D } from './components/IntroMenu3D.jsx';
import { Hud, IntroOverlay, PointerCursor, ModePicker } from './components/Hud.jsx';
import { MobileControls } from './components/MobileControls.jsx';
import { Toaster } from './components/ui/sonner.jsx';
import { emitOpenFriends, emitSocialNotification, socialNotificationKey, SOCIAL_NOTIFICATION_EVENT } from './social-notifications.js';
import { useFrame, useThree } from '@react-three/fiber';

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
  const stats = useRef({ frames: 0, sum: 0, dpr: targetDpr, last: 0, slow: 0, fast: 0 });
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
    if (!perfHudEnabled) return undefined;
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
      const slow = avg > 0.019;
      const fast = avg < 0.0145;
      data.slow = slow ? data.slow + 1 : 0;
      data.fast = fast ? data.fast + 1 : 0;
      if (data.slow >= 2 && data.dpr > perfSettings.minDpr) {
        data.dpr = Math.max(perfSettings.minDpr, data.dpr - 0.2);
        setDpr(data.dpr);
        data.slow = 0;
        data.fast = 0;
      } else if (data.fast >= 6 && data.dpr < targetDpr) {
        data.dpr = Math.min(targetDpr, data.dpr + 0.05);
        setDpr(data.dpr);
        data.fast = 0;
      }
      data.frames = 0;
      data.sum = 0;
    }

    if (perfHudEnabled && state.clock.elapsedTime - data.last > 0.5) {
      data.last = state.clock.elapsedTime;
      const info = gl.info;
      const message = `quality=${perfSettings.name} scale=${renderScale}\ndpr=${data.dpr.toFixed(2)} fps=${Math.round(1 / Math.max(delta, 0.001))}\ncalls=${info.render.calls} tris=${info.render.triangles}\ngeoms=${info.memory.geometries} tex=${info.memory.textures}`;
      if (hud.current) hud.current.textContent = message;
    }
  });

  return null;
}

function SocialNotificationBridge() {
  const shown = useRef(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onNotification = (event) => {
      const payload = event.detail || {};
      const kind = payload.kind || (payload.inviteId ? 'game_invite' : 'social');
      const id = socialNotificationKey(payload);
      if (shown.current.has(id)) return;
      shown.current.add(id);
      setTimeout(() => shown.current.delete(id), 30000);

      const title = payload.title || (kind === 'friend_request' ? 'Backspin friend request' : 'Backspin invite');
      const description = payload.body || (kind === 'friend_request' ? 'A player sent you a friend request' : 'A friend invited you to play');
      const url = new URL(payload.url || '/', window.location.origin).href;
      const action = kind === 'friend_request'
        ? { label: 'View Friends', onClick: () => emitOpenFriends(payload) }
        : { label: 'Join Game', onClick: () => window.location.assign(url) };

      toast(title, {
        description,
        duration: 10000,
        action,
      });
    };
    window.addEventListener(SOCIAL_NOTIFICATION_EVENT, onNotification);
    return () => window.removeEventListener(SOCIAL_NOTIFICATION_EVENT, onNotification);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined;
    const onMessage = (event) => {
      if (event.data?.type !== 'backspin:push-notification') return;
      const payload = event.data.payload || {};
      emitSocialNotification(payload, 'push');
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  return null;
}

export default function App() {
  const performanceRevision = useGameStore((state) => state.performanceRevision);
  const renderScale = useGameStore((state) => state.performancePrefs.renderScale);
  const targetDpr = renderScaleDpr[renderScale] || renderScaleDpr.medium;
  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <Canvas
        shadows={renderScale !== 'low'}
        dpr={[0.7, targetDpr]}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false }}
        camera={{
          fov: 44,
          position: CAMERA.desktopPosition,
          near: 0.1,
          far: 45,
        }}
      >
        <PerformanceRuntime />
        <WorldBackground />
        <Suspense fallback={null}>
          <SceneContent key={performanceRevision} />
          <Preload all />
        </Suspense>
      </Canvas>
      <Hud />
      <PointerCursor />
      <ModePicker />
      <MobileControls />
      <IntroOverlay />
      <SocialNotificationBridge />
      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}
