export function otherSide(side) {
  if (side === 'player') return 'ai';
  if (side === 'ai') return 'player';
  return side === 'p1' ? 'p2' : 'p1';
}

export function currentServer(firstServer, scoreA, scoreB, other = otherSide) {
  const total = scoreA + scoreB;
  const bucket = scoreA >= 10 && scoreB >= 10 ? total : Math.floor(total / 2);
  return bucket % 2 === 0 ? firstServer : other(firstServer);
}

export function pointQuality(reason, exchange = 0) {
  if (reason === 'WINNER' && exchange === 0) return 0.9;
  if (reason === 'WINNER') return 0.75;
  if (reason === 'NET' || reason === 'OUT' || reason === 'FAULT') return 0.3;
  return 0.45;
}

export function scorePoint({ scoreA, scoreB, winner, sideA = 'p1', sideB = 'p2', winScore = 11 }) {
  const nextA = scoreA + (winner === sideA ? 1 : 0);
  const nextB = scoreB + (winner === sideB ? 1 : 0);
  const over = Math.max(nextA, nextB) >= winScore && Math.abs(nextA - nextB) >= 2;
  return { scoreA: nextA, scoreB: nextB, over, winner: over ? winner : null };
}

export function resolveBouncePoint({ side, lastHitter, exchange, serveBounceCount, bouncedReceiver }) {
  if (!lastHitter) return { bouncedReceiver, serveBounceCount };
  if (exchange === 0) {
    const nextServeBounceCount = serveBounceCount + 1;
    if (nextServeBounceCount === 1) {
      return side !== lastHitter
        ? { winner: otherSide(lastHitter), reason: 'FAULT', serveBounceCount: nextServeBounceCount, bouncedReceiver }
        : { serveBounceCount: nextServeBounceCount, bouncedReceiver };
    }
    if (nextServeBounceCount === 2) {
      return side === lastHitter
        ? { winner: otherSide(lastHitter), reason: 'FAULT', serveBounceCount: nextServeBounceCount, bouncedReceiver }
        : { serveBounceCount: nextServeBounceCount, bouncedReceiver: true };
    }
    return { winner: lastHitter, reason: 'WINNER', serveBounceCount: nextServeBounceCount, bouncedReceiver };
  }
  if (side === lastHitter) return { winner: otherSide(lastHitter), reason: 'FAULT', serveBounceCount, bouncedReceiver };
  if (bouncedReceiver) return { winner: lastHitter, reason: 'WINNER', serveBounceCount, bouncedReceiver };
  return { serveBounceCount, bouncedReceiver: true };
}

export function resolveOutPoint({ lastHitter, exchange, serveBounceCount, bouncedReceiver }) {
  if (!lastHitter) return null;
  const serveFault = exchange === 0 && serveBounceCount < 2;
  if (serveFault) return { winner: otherSide(lastHitter), reason: 'FAULT' };
  return bouncedReceiver
    ? { winner: lastHitter, reason: 'WINNER' }
    : { winner: otherSide(lastHitter), reason: 'OUT' };
}
