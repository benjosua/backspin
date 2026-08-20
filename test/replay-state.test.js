import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { useGameStore } = await import('../src/store.js');

test('replay starts from frame score instead of final match score', () => {
  useGameStore.getState().startReplayMode({
    match: { p1Score: 11, p2Score: 8 },
    viewerSide: 'p1',
    durationMs: 1000,
    scoreP: 3,
    scoreAI: 2,
  });

  const state = useGameStore.getState();
  assert.equal(state.scoreP, 3);
  assert.equal(state.scoreAI, 2);
});

test('replay loading clears stale final score before first replay frame', () => {
  useGameStore.setState({ started: true, scoreP: 11, scoreAI: 4, phase: 'over', winner: 'player' });

  useGameStore.getState().setReplayLoading();

  const state = useGameStore.getState();
  assert.equal(state.scoreP, 0);
  assert.equal(state.scoreAI, 0);
  assert.equal(state.phase, 'serve');
  assert.equal(state.winner, null);
});

test('online room patches do not overwrite replay score', () => {
  useGameStore.setState({ started: true, mode: 'replay', scoreP: 0, scoreAI: 0, phase: 'serve', winner: null });

  useGameStore.getState().syncOnlineState({ scoreP: 11, scoreAI: 4, phase: 'over', winner: 'player' });

  const state = useGameStore.getState();
  assert.equal(state.scoreP, 0);
  assert.equal(state.scoreAI, 0);
  assert.equal(state.phase, 'serve');
  assert.equal(state.winner, null);
});
