import { useEffect, useRef, useState } from 'react';
import { getActiveGameDriver } from '../game-drivers.js';
import { useGameStore } from '../store.js';

const coarseQuery = '(pointer: coarse)';
const JOYSTICK_SIZE = 112;
const clampAxis = (value) => Math.max(-1, Math.min(1, value));

function isCoarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia(coarseQuery).matches;
}

export function MobileControls() {
  const [enabled, setEnabled] = useState(isCoarsePointer);
  const lastDriver = useRef(null);
  const started = useGameStore((state) => state.started);
  const menuOpen = useGameStore((state) => state.menuOpen);
  const mode = useGameStore((state) => state.mode);
  const visible = enabled && started && !menuOpen && mode !== 'replay';

  useEffect(() => {
    const query = window.matchMedia(coarseQuery);
    const update = () => setEnabled(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  const setAxis = (axis = 0) => {
    const driver = getActiveGameDriver();
    lastDriver.current = driver;
    driver.setMoveAxis?.(clampAxis(axis));
  };

  const resetAxis = () => {
    lastDriver.current?.setMoveAxis?.(0);
    getActiveGameDriver().setMoveAxis?.(0);
  };

  useEffect(() => {
    if (!visible) resetAxis();
    return resetAxis;
  }, [visible]);

  if (!visible) return null;

  const updateAxis = (event) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    setAxis((event.clientX - left - width / 2) / (width / 2));
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[10003]" aria-hidden="true">
      <div
        className="pointer-events-auto absolute bottom-5 left-5 rounded-full touch-none"
        style={{ width: JOYSTICK_SIZE, height: JOYSTICK_SIZE }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateAxis(event);
          event.preventDefault();
        }}
        onPointerMove={updateAxis}
        onPointerUp={resetAxis}
        onPointerCancel={resetAxis}
        onLostPointerCapture={resetAxis}
      />
    </div>
  );
}
