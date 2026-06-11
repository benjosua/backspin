# Backspin

Standalone source version. Includes local assets and modified light hall environment.

## Run

```bash
cd backspin
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

Health check:

```bash
curl http://localhost:2567/healthz
```

Public deployment notes:

- Deploy with Dockerfile from repository root.
- Expose port `2567`.
- Set `NODE_ENV=production`.
- Do not set `VITE_COLYSEUS_URL` for same-origin deploys; client uses current public origin.
- Optional: set `ENABLE_MONITOR=true` only behind private auth/network controls.

Pre-deploy verification:

```bash
npm run check
docker build -t backspin .
```
