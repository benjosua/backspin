// Recovered Zustand store from production bundle.
import { create } from 'zustand';
import { COLORS, DEFAULT_DIFFICULTY, DEFAULT_PADDLE } from './constants.js';

export const DEBUG_MODE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

export const debugFlags = { forceOver: null };

export const useGameStore = create((set, get) => ({
  revealed: DEBUG_MODE,
  started: DEBUG_MODE,
  scoreP: 0,
  scoreAI: 0,
  phase: 'serve',
  server: 'player',
  flashText: '',
  flashColor: COLORS.ink,
  flashId: 0,
  winner: null,
  menuOpen: false,
  difficulty: DEFAULT_DIFFICULTY,
  paddle: DEFAULT_PADDLE,
  resetNonce: 0,
  mode: 'offline',
  networkStatus: 'idle',
  networkError: '',
  roomCode: '',
  onlineSide: null,
  debugRevision: 0,

  reveal: () => set({ revealed: true }),

  start: () =>
    set((state) => ({
      started: true,
      mode: 'offline',
      networkStatus: 'idle',
      networkError: '',
      roomCode: '',
      onlineSide: null,
      scoreP: 0,
      scoreAI: 0,
      phase: 'serve',
      winner: null,
      flashText: '',
      flashId: 0,
      menuOpen: false,
      resetNonce: state.resetNonce + 1,
    })),

  backToMenu: () =>
    set((state) => ({
      started: false,
      mode: 'offline',
      networkStatus: 'idle',
      networkError: '',
      roomCode: '',
      onlineSide: null,
      scoreP: 0,
      scoreAI: 0,
      phase: 'serve',
      winner: null,
      flashText: '',
      flashId: 0,
      menuOpen: false,
      resetNonce: state.resetNonce + 1,
    })),

  goHome: () => get().backToMenu(),

  setPaddle: (paddle) =>
    set((state) => ({ paddle, resetNonce: state.resetNonce + 1 })),

  newGame: () =>
    set((state) => ({
      scoreP: 0,
      scoreAI: 0,
      phase: 'serve',
      winner: null,
      flashText: '',
      flashId: 0,
      resetNonce: state.resetNonce + 1,
    })),

  setDifficulty: (difficulty) =>
    set((state) => ({
      difficulty,
      scoreP: 0,
      scoreAI: 0,
      phase: 'serve',
      winner: null,
      flashText: '',
      flashId: 0,
      menuOpen: false,
      resetNonce: state.resetNonce + 1,
    })),

  setPhase: (phase) => set({ phase }),
  setServer: (server) => set({ server }),
  setWinner: (winner) => set({ winner }),

  startOnline: () =>
    set((state) => ({
      started: true,
      mode: 'online',
      scoreP: 0,
      scoreAI: 0,
      phase: 'serve',
      server: 'player',
      winner: null,
      flashText: '',
      flashId: 0,
      menuOpen: false,
      resetNonce: state.resetNonce + 1,
    })),

  setNetworkStatus: (networkStatus, networkError = '') => set({ networkStatus, networkError }),
  setOnlineSide: (onlineSide, roomCode) => set({ onlineSide, roomCode }),
  syncOnlineState: (next) => set((state) => ({ ...next, flashId: next.phase === 'point' && state.phase !== 'point' ? state.flashId + 1 : state.flashId })),

  bumpScore: (who) =>
    set((state) =>
      who === 'player' ? { scoreP: state.scoreP + 1 } : { scoreAI: state.scoreAI + 1 },
    ),

  flash: (flashText, flashColor) =>
    set((state) => ({ flashText, flashColor, flashId: state.flashId + 1 })),

  toggleMenu: () => set((state) => ({ menuOpen: !state.menuOpen })),
  openMenu: () => set({ menuOpen: true }),
  closeMenu: () => set({ menuOpen: false }),
  bumpDebugRevision: () => set((state) => ({ debugRevision: state.debugRevision + 1 })),
}));

export const randomSide = () => (Math.random() < 0.5 ? 'player' : 'ai');
