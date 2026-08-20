import { CanvasTexture } from 'three';

export function makeGlowTexture(rgb, strong = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (strong) {
    gradient.addColorStop(0, `rgba(${rgb},0.85)`);
    gradient.addColorStop(0.55, `rgba(${rgb},0.45)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
  } else {
    gradient.addColorStop(0, `rgba(${rgb},0.8)`);
    gradient.addColorStop(0.35, `rgba(${rgb},0.3)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}
