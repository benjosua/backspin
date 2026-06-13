// Recovered Zustand store from production bundle.
import { create } from 'zustand';
import { COLORS, DEFAULT_DIFFICULTY, PLAYER_SPEED } from './constants.js';

export const DEBUG_MODE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

export const debugFlags = { forceOver: null };

const clampPlayerSpeed = (value) => Math.max(PLAYER_SPEED.min, Math.min(PLAYER_SPEED.max, value));
const normalizePlayerName = (value) => {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
};
export const RENDER_SCALES = {
  low: { label: 'LOW', dpr: 0.9 },
  medium: { label: 'MED', dpr: 1.25 },
  high: { label: 'HIGH', dpr: 1.75 },
};

function devicePrefersLowFx() {
  if (typeof window === 'undefined') return true;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  return coarse || memory <= 4 || cores <= 4;
}

function queryRenderScale() {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('quality');
  return RENDER_SCALES[value] ? value : null;
}

function defaultPerformancePrefs() {
  const queryScale = queryRenderScale();
  return {
    renderScale: queryScale || 'medium',
    extraFx: queryScale === 'low' ? false : !devicePrefersLowFx(),
  };
}

const PERFORMANCE_PREFS_KEY = 'backspin.performancePrefs.v1';
function readPerformancePrefs() {
  const defaults = defaultPerformancePrefs();
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const saved = JSON.parse(localStorage.getItem(PERFORMANCE_PREFS_KEY) || 'null');
    return {
      renderScale: RENDER_SCALES[saved?.renderScale] ? saved.renderScale : defaults.renderScale,
      extraFx: typeof saved?.extraFx === 'boolean' ? saved.extraFx : defaults.extraFx,
    };
  } catch {
    return defaults;
  }
}

function persistPerformancePrefs(performancePrefs) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PERFORMANCE_PREFS_KEY, JSON.stringify(performancePrefs));
}

const readPlayerSpeed = () => {
  if (typeof localStorage === 'undefined') return PLAYER_SPEED.default;
  const value = Number(localStorage.getItem('backspin.playerSpeed'));
  return Number.isFinite(value) ? clampPlayerSpeed(value) : PLAYER_SPEED.default;
};
const readPlayerName = () => {
  if (typeof localStorage === 'undefined') return 'PLAYER';
  return normalizePlayerName(localStorage.getItem('backspin.playerName')) || 'PLAYER';
};

const resetPlayState = (state, extra = {}) => ({
  scoreP: 0,
  scoreAI: 0,
  phase: 'serve',
  winner: null,
  flashText: '',
  flashId: 0,
  resetNonce: state.resetNonce + 1,
  ...extra,
});

const resetOnlineState = () => ({
  networkStatus: 'idle',
  networkError: '',
  roomCode: '',
  onlineSide: null,
  currentMatchId: '',
  emotes: { player: null, ai: null },
  onlineRematchRequested: false,
  opponentName: 'OPPONENT',
});

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
  playerSpeed: readPlayerSpeed(),
  playerName: readPlayerName(),
  opponentName: 'OPPONENT',
  performancePrefs: readPerformancePrefs(),
  performanceRevision: 0,
  resetNonce: 0,
  mode: 'offline',
  networkStatus: 'idle',
  networkError: '',
  roomCode: '',
  onlineSide: null,
  currentMatchId: '',
  emotes: { player: null, ai: null },
  emoteSeq: 0,
  authUser: null,
  authToken: null,
  rankedProfile: null,
  leaderboard: [],
  rankedQueueCount: 0,
  onlineRematchRequested: false,
  replayBrowserOpen: false,
  replayStatus: 'idle',
  replayError: '',
  replayMatch: null,
  replayStats: null,
  replayViewerSide: 'p1',
  replayTimeMs: 0,
  replayDurationMs: 0,
  replayPlaying: false,
  replaySpeed: 1,
  debugRevision: 0,

  reveal: () => set({ revealed: true }),

  start: () =>
    set((state) => ({
      started: true,
      mode: 'offline',
      ...resetOnlineState(),
      ...resetPlayState(state),
      menuOpen: false,
    })),

  backToMenu: () =>
    set((state) => ({
      started: false,
      mode: 'offline',
      ...resetOnlineState(),
      ...resetPlayState(state),
      menuOpen: false,
    })),

  goHome: () => get().backToMenu(),

  setPlayerSpeed: (playerSpeed) => {
    const next = clampPlayerSpeed(Number(playerSpeed) || PLAYER_SPEED.default);
    if (typeof localStorage !== 'undefined') localStorage.setItem('backspin.playerSpeed', String(next));
    set({ playerSpeed: next });
  },

  setPlayerName: (playerName) => {
    const next = normalizePlayerName(playerName);
    if (typeof localStorage !== 'undefined') localStorage.setItem('backspin.playerName', next);
    set({ playerName: next });
  },

  setPerformancePref: (key, value) =>
    set((state) => {
      const performancePrefs = { ...state.performancePrefs, [key]: value };
      persistPerformancePrefs(performancePrefs);
      return {
        performancePrefs,
        performanceRevision: key === 'extraFx' ? state.performanceRevision + 1 : state.performanceRevision,
      };
    }),

  newGame: () =>
    set((state) => resetPlayState(state)),

  setDifficulty: (difficulty) =>
    set((state) => resetPlayState(state, { difficulty, menuOpen: false })),

  setPhase: (phase) => set({ phase }),
  setServer: (server) => set({ server }),
  setWinner: (winner) => set({ winner }),

  startOnline: () =>
    set((state) => ({
      started: true,
      mode: 'online',
      ...resetPlayState(state, {
        emotes: { player: null, ai: null },
        onlineRematchRequested: false,
        currentMatchId: '',
        menuOpen: false,
      }),
      server: 'player',
      opponentName: 'OPPONENT',
    })),

  setNetworkStatus: (networkStatus, networkError = '') => set({ networkStatus, networkError }),
  setOnlineSide: (onlineSide, roomCode) => set({ onlineSide, roomCode }),
  setCurrentMatchId: (currentMatchId) => set({ currentMatchId: currentMatchId || '' }),
  showEmote: (side, emoji) =>
    set((state) => {
      const emote = { id: state.emoteSeq + 1, emoji, at: performance.now() };
      return {
        emoteSeq: emote.id,
        emotes: { ...state.emotes, [side]: emote },
      };
    }),
  setAuth: (authUser, authToken) => set({ authUser, authToken }),
  setRankedProfile: (rankedProfile) => set({ rankedProfile }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setRankedQueueCount: (rankedQueueCount) => set({ rankedQueueCount }),
  setOnlineRematchRequested: (onlineRematchRequested) => set({ onlineRematchRequested }),
  openReplayBrowser: () => set({ replayBrowserOpen: true, replayError: '' }),
  closeReplayBrowser: () => set({ replayBrowserOpen: false, replayError: '' }),
  setReplayLoading: () => set({ replayStatus: 'loading', replayError: '', replayPlaying: false }),
  setReplayError: (replayError) => set({ replayStatus: 'error', replayError: replayError || 'Replay failed', replayPlaying: false }),
  startReplayMode: ({ match, stats, viewerSide, durationMs }) =>
    set({
      started: true,
      mode: 'replay',
      networkStatus: 'idle',
      networkError: '',
      menuOpen: false,
      replayBrowserOpen: false,
      replayStatus: 'ready',
      replayError: '',
      replayMatch: match || null,
      replayStats: stats || null,
      replayViewerSide: viewerSide || 'p1',
      replayTimeMs: 0,
      replayDurationMs: durationMs || 0,
      replayPlaying: true,
      scoreP: viewerSide === 'p2' ? (match?.p2Score || 0) : (match?.p1Score || 0),
      scoreAI: viewerSide === 'p2' ? (match?.p1Score || 0) : (match?.p2Score || 0),
      phase: 'serve',
      server: 'player',
      winner: null,
      flashText: '',
      flashId: 0,
    }),
  stopReplayMode: () =>
    set({
      started: false,
      mode: 'offline',
      replayStatus: 'idle',
      replayError: '',
      replayMatch: null,
      replayStats: null,
      replayTimeMs: 0,
      replayDurationMs: 0,
      replayPlaying: false,
      phase: 'serve',
      winner: null,
      menuOpen: false,
    }),
  setReplayPlaying: (replayPlaying) => set({ replayPlaying }),
  setReplaySpeed: (replaySpeed) => set({ replaySpeed: Number(replaySpeed) || 1 }),
  setReplayTime: (replayTimeMs) => set({ replayTimeMs: Math.max(0, Number(replayTimeMs) || 0) }),
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
