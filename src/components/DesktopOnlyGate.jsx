// Recovered desktop-only gate from production bundle function `xM`.

import { useEffect, useState } from 'react';

const coarseQuery = '(pointer: coarse)';
const narrowQuery = '(max-width: 640px)';

function shouldBlock() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(coarseQuery).matches || window.matchMedia(narrowQuery).matches;
}

export function DesktopOnlyGate({ children }) {
  const [blocked, setBlocked] = useState(shouldBlock);

  useEffect(() => {
    const coarse = window.matchMedia(coarseQuery);
    const narrow = window.matchMedia(narrowQuery);
    const update = () => setBlocked(coarse.matches || narrow.matches);
    coarse.addEventListener('change', update);
    narrow.addEventListener('change', update);
    update();
    return () => {
      coarse.removeEventListener('change', update);
      narrow.removeEventListener('change', update);
    };
  }, []);

  if (blocked) {
    return (
      <div className="desktop-only">
        <div className="desktop-only-title" aria-hidden="true">RALLY</div>
        <p className="desktop-only-msg">This is a desktop-only experiment.</p>
        <p className="desktop-only-hint">Open on a computer to play.</p>
      </div>
    );
  }

  return children;
}
