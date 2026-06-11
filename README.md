# Rally recovered game

Standalone recovered source version. Includes local assets and modified light hall environment.

## Run

```bash
cd /Users/ben/workspace/rally-recovered-game
npm install
npm run dev
```

Open the Vite URL, usually http://localhost:5173/.

## Notes

- Source lives in `src/`.
- Game assets live in `public/`.
- The hall change is `public/environment-baked.glb`.

## Docker deployment

Build and run one production container. Colyseus serves API/WebSocket traffic and the built Vite client from the same origin.

```bash
npm run docker:build
npm run docker:run
```

Or with Compose:

```bash
npm run docker:up
```

Open `http://localhost:2567`.
