# Backspin server

Colyseus multiplayer server for Backspin.

## Usage

```sh
npm start
npm test
npm run build
```

## Structure

- `src/index.ts`: server entrypoint.
- `src/app.config.ts`: Colyseus rooms, Express API routes, monitor/playground wiring.
- `src/rooms/BackspinRoom.ts`: authoritative match simulation.
- `src/rooms/RankedQueueRoom.ts`: ranked matchmaking queue.
- `src/matches/`: match stats and replay persistence.
- `src/ranked/`: account/rating storage and Elo logic.
- `src/shared/`: shared game logic imported by both server and client.
- `loadtest/example.ts`: scriptable client for `npm run loadtest`.
