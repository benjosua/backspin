import nipplejs from 'nipplejs';
import { useEffect, useRef, useState } from 'react';
import { getActiveGameDriver } from '../game-drivers.js';
import { MOVE_AXIS_DEADZONE } from '../input-utils.js';
import { useGameStore } from '../store.js';

const coarseQuery = '(pointer: coarse)';

function isCoarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia(coarseQuery).matches;
}

export function MobileControls() {
  const [enabled, setEnabled] = useState(isCoarsePointer);
  const zoneRef = useRef(null);
  const started = useGameStore((state) => state.started);
  const menuOpen = useGameStore((state) => state.menuOpen);
  const mode = useGameStore((state) => state.mode);

  useEffect(() => {
    const query = window.matchMedia(coarseQuery);
    const update = () => setEnabled(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!enabled || !zone) return;
    const manager = nipplejs.create({
      zone,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: '#efe7d8',
      size: 112,
      threshold: MOVE_AXIS_DEADZONE,
    });
    const applyAxis = (axis) => {
      getActiveGameDriver().setMoveAxis?.(axis);
    };
    const onMove = (_evt, data) => {
      const x = data?.vector?.x || 0;
      const strength = Math.min(1, data?.force || 0);
      applyAxis(x * strength);
    };
    const onEnd = () => applyAxis(0);
    manager.on('move', onMove);
    manager.on('end', onEnd);
    return () => {
      onEnd();
      manager.destroy();
    };
  }, [enabled]);

  const visible = enabled && started && !menuOpen && mode !== 'replay';
  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[10003]" aria-hidden>
      <div className="pointer-events-auto absolute bottom-5 left-5 size-32 rounded-full touch-none" ref={zoneRef} />
    </div>
  );
}
