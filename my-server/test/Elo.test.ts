import assert from "node:assert/strict";
import { applyElo, expectedScore, kFactor, RATING_FLOOR } from "../src/ranked/elo.js";

describe("ranked Elo", () => {
  it("moves provisional equal-rated players faster", () => {
    const result = applyElo({ rating: 1200, gamesPlayed: 0 }, { rating: 1200, gamesPlayed: 0 });
    assert.equal(result.winnerDelta, 24);
    assert.equal(result.loserDelta, -24);
  });

  it("slows established high-rated players", () => {
    assert.equal(kFactor({ rating: 1400, gamesPlayed: 30 }), 32);
    assert.equal(kFactor({ rating: 1600, gamesPlayed: 30 }), 28);
    assert.equal(kFactor({ rating: 1900, gamesPlayed: 30 }), 24);
  });

  it("rewards underdog wins more than favorite wins", () => {
    const underdogWin = applyElo({ rating: 1000, gamesPlayed: 30 }, { rating: 1400, gamesPlayed: 30 });
    const favoriteWin = applyElo({ rating: 1400, gamesPlayed: 30 }, { rating: 1000, gamesPlayed: 30 });
    assert.ok(underdogWin.winnerDelta > favoriteWin.winnerDelta);
    assert.ok(Math.abs(underdogWin.loserDelta) > Math.abs(favoriteWin.loserDelta));
  });

  it("keeps ratings above floor", () => {
    const result = applyElo({ rating: 1200, gamesPlayed: 30 }, { rating: RATING_FLOOR, gamesPlayed: 30 });
    assert.equal(result.loserRating, RATING_FLOOR);
    assert.equal(expectedScore(1200, 1200), 0.5);
  });
});
