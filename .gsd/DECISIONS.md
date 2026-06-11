# Decisions

## Backspin mechanics abstraction

Chosen shape: shared `BackspinCore` mechanics module split by responsibility: `ShotEngine` (`classifyShot`, `resolvePlayerShot`), `Ballistics` (`solveShot`, `solveSafeShot`, bounce simulation), and `ViewHints` (`predictBounceKick`). Offline engine, online client prediction, and Colyseus server now call the shared module instead of each carrying separate shot rules.

Reason: smash/spin/block/lob/counter rules need one source of truth across offline and multiplayer. Keeping visuals as predictions from the same ballistics layer prevents marker code from changing scoring, while keeping scoring/exchange phase code procedural for now avoids risky full engine rewrite.
