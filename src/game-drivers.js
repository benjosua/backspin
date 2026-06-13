import { game } from './engine.js';
import { networkGame } from './network.js';
import { replayGame } from './replay.js';
import { useGameStore } from './store.js';

export const gameDrivers = {
  offline: game,
  online: networkGame,
  replay: replayGame,
};

export function getActiveGameDriver(mode = useGameStore.getState().mode) {
  return gameDrivers[mode] || game;
}
