// Recovered camera loop wrapper around the recovered GameEngine.

import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { game } from '../engine.js';
import { getDebugTime } from '../debug-tuning.js';
import { useGameStore } from '../store.js';

const lookAt = new Vector3();

export function GameLoop() {
  const resetNonce = useGameStore((state) => state.resetNonce);

  useFrame((state, delta) => {
    if (game._lastResetNonce !== resetNonce) {
      game._lastResetNonce = resetNonce;
      game.newMatch();
    }

    game.update(delta, getDebugTime(state.clock.elapsedTime), state.camera);

    state.camera.position.set(game.camX, game.camY, game.camZ);
    lookAt.set(game.camLX, game.camLY, game.camLZ);
    state.camera.lookAt(lookAt);
    state.camera.fov = game.camFov;
    state.camera.updateProjectionMatrix();
  });

  return null;
}
