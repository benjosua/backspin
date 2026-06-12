export const DEFAULT_RATING = 1200;
export const ELO_K = 32;

export function eloDelta(rating: number, opponentRating: number, score: 0 | 1) {
  const expected = 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
  return Math.round(ELO_K * (score - expected));
}

export function applyElo(winnerRating: number, loserRating: number) {
  const winnerDelta = eloDelta(winnerRating, loserRating, 1);
  const loserDelta = eloDelta(loserRating, winnerRating, 0);
  return {
    winnerDelta,
    loserDelta,
    winnerRating: winnerRating + winnerDelta,
    loserRating: loserRating + loserDelta,
  };
}
