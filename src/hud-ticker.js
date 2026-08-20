const callbacks = new Set();
let raf = 0;

function tick() {
  for (const callback of callbacks) callback();
  raf = callbacks.size ? requestAnimationFrame(tick) : 0;
}

export function subscribeHudFrame(callback) {
  callbacks.add(callback);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
