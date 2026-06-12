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
      <div className="fixed inset-0 z-[10001] flex flex-col items-center justify-center gap-5 bg-background p-8 text-center text-foreground">
        <div className="pl-[0.34em] text-6xl font-semibold tracking-[0.34em] text-foreground" aria-hidden="true">BACKSPIN</div>
        <p className="max-w72 text-sm text-muted-foreground">This is a desktop-only experiment.</p>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Open on a computer to play.</p>
      </div>
    );
  }

  return children;
}
