import { Shape } from 'three';

export function createPaddleHeadShape(scale = 1) {
  const shape = new Shape();
  shape.moveTo(-0.23 * scale, -0.52 * scale);
  shape.lineTo(0.23 * scale, -0.52 * scale);
  shape.bezierCurveTo(0.43 * scale, -0.46 * scale, 0.56 * scale, -0.18 * scale, 0.52 * scale, 0.12 * scale);
  shape.bezierCurveTo(0.49 * scale, 0.43 * scale, 0.27 * scale, 0.62 * scale, 0 * scale, 0.64 * scale);
  shape.bezierCurveTo(-0.27 * scale, 0.62 * scale, -0.49 * scale, 0.43 * scale, -0.52 * scale, 0.12 * scale);
  shape.bezierCurveTo(-0.56 * scale, -0.18 * scale, -0.43 * scale, -0.46 * scale, -0.23 * scale, -0.52 * scale);
  return shape;
}

export const paddleHeadExtrude = {
  depth: 0.045,
  bevelEnabled: true,
  bevelThickness: 0.01,
  bevelSize: 0.012,
  bevelSegments: 4,
  curveSegments: 24,
};
