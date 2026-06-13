export const DEFAULT_RATING = 1200;
export const RATING_FLOOR = 100;

export type EloPlayer = {
  rating: number;
  gamesPlayed?: number;
};

export function kFactor(player: EloPlayer) {
  const games = Math.max(0, player.gamesPlayed ?? 0);
  const rating = Math.max(RATING_FLOOR, player.rating || DEFAULT_RATING);
  if (games < 10) return 48;      // placement: fast calibration like Glicko/TrueSkill-style uncertainty
  if (games < 30) return 40;      // early ladder: still moves quickly
  if (rating >= 1800) return 24;  // high rank: tighter, more Master Rating style
  if (rating >= 1500) return 28;
  return 32;                      // established default Elo pace
}

export function expectedScore(rating: number, opponentRating: number) {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

export function eloDelta(player: EloPlayer, opponent: EloPlayer, score: 0 | 1) {
  const expected = expectedScore(player.rating, opponent.rating);
  return Math.round(kFactor(player) * (score - expected));
}

export function applyElo(winner: EloPlayer | number, loser: EloPlayer | number) {
  const winnerPlayer = typeof winner === "number" ? { rating: winner, gamesPlayed: 30 } : winner;
  const loserPlayer = typeof loser === "number" ? { rating: loser, gamesPlayed: 30 } : loser;
  const winnerDelta = eloDelta(winnerPlayer, loserPlayer, 1);
  const rawLoserDelta = eloDelta(loserPlayer, winnerPlayer, 0);
  const loserDelta = Math.max(rawLoserDelta, RATING_FLOOR - loserPlayer.rating);
  return {
    winnerDelta,
    loserDelta,
    winnerRating: winnerPlayer.rating + winnerDelta,
    loserRating: loserPlayer.rating + loserDelta,
  };
}
