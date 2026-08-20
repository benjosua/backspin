# 🏓 Backspin

> **Fast-paced, real-time 3D multiplayer table tennis with client prediction, ranked matchmaking, and instant replays.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/Node.js-%3E%3D20.9.0-green.svg)](https://nodejs.org)
[![Three.js](https://img.shields.io/badge/Three.js-r160+-black.svg)](https://threejs.org/)
[![Colyseus](https://img.shields.io/badge/Colyseus-0.17-orange.svg)](https://colyseus.io/)

![Backspin Gameplay Preview](docs/assets/gameplay-preview.png)
![Backspin Menu Preview](docs/assets/menu-preview.png)

---

## Overview

**Backspin** is a browser-based 3D table tennis game built for competitive multiplayer and instant action. It combines physics simulations in Three.js / React Three Fiber with an authoritative Colyseus backend, client-side prediction, Elo rating matchmaking, and frame-accurate replays.

Play solo against adaptive AI opponents, challenge friends with private room codes, or climb the global ranked leaderboard.

---

## Features

- **Responsive 3D Gameplay:** Real-time physics simulation powered by Three.js and React Three Fiber with custom shaders, dynamic lighting, audio feedback, and mobile touch controls.
- **Low-Latency Netcode:** Authoritative Colyseus game server with client prediction, latency lead extrapolation, and smooth correction decay for seamless online play.
- **Ranked Matchmaking & Elo:** Competitive queue system with instant matchmaking, skill-based matchmaking (Elo), rank progression, and global leaderboards.
- **Instant Match & Shot Replays:** Server-side match recording allowing players to review full matches or individual shot exchanges with free-camera replay inspection.
- **Social & Notifications:** Friends system, direct game invitations, and Web Push notifications for real-time challenge alerts.
- **Customization:** Unlockable paddle colors based on games played and competitive achievements.

---

## Tech Stack

- **Frontend:** React 19, React Three Fiber, Three.js, Zustand, TailwindCSS, Lucide Icons, Vite
- **Backend:** Node.js (ESM), TypeScript, Colyseus 0.17, Express, `@colyseus/auth`
- **Database:** PostgreSQL 16 (Users, Elo ratings, Match history, Chunked replays, Social graphs)
- **Deployment & Dev:** Docker, Docker Compose, PM2, GitHub Actions CI

---

## Quick Start

### Option 1: Docker Compose (Recommended)

Start all services (Client, Game Server, PostgreSQL) in one command:

```bash
git clone https://github.com/benjosua/backspin.git
cd backspin

# Start dev stack with live code watching & hot-reload
npm run docker:up
```

- **Web Client:** http://localhost:5173
- **Colyseus Server:** http://localhost:2567
- **Colyseus Playground:** http://localhost:2567/colyseus

### Option 2: Native Local Development

#### Prerequisites
- Node.js (>= 20.9.0)
- Docker (for local PostgreSQL instance)

#### 1. Install Dependencies

```bash
npm install
npm --prefix serve install
```

#### 2. Start PostgreSQL

```bash
docker compose up -d postgres
```

#### 3. Setup Environment Variables

```bash
cp .env.example .env
cp serve/.env.example serve/.env
```

#### 4. Run Development Servers

In terminal 1 (Game Server):
```bash
npm --prefix serve run start
```

In terminal 2 (Frontend Client):
```bash
npm run dev
```

Open http://localhost:5173 to play!

---

## Available Scripts

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Start Vite dev server for frontend |
| `npm run build` | Build production bundle for frontend |
| `npm run check` | Run full test suite & type checks across client and server |
| `npm run client:test` | Run frontend unit tests |
| `npm run server:test` | Run server test suite against test PostgreSQL container |
| `npm run server:build` | Compile TypeScript server code |
| `npm run docker:up` | Launch local full stack with Docker Compose watch mode |
| `npm run docker:prod:build` | Build production container image |
| `npm run docker:prod:run` | Run standalone production container |

---

## Environment Variables

### Client (`.env`)

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `VITE_COLYSEUS_URL` | `http://localhost:2567` | URL of the Colyseus backend server |

### Server (`serve/.env`)

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `2567` | HTTP / WebSocket server port |
| `DATABASE_URL` | `postgres://...` | PostgreSQL connection string |
| `JWT_SECRET` | `dev-ranked-secret` | Secret key for signing user authentication tokens |
| `AUTH_SALT` | `dev-ranked-salt` | Password hashing salt |
| `SESSION_SECRET` | `dev-ranked-session` | Express session secret |
| `PUBLIC_APP_URL` | `http://localhost:5173` | Public origin used for invite and notification links |
| `ENABLE_MONITOR` | `false` | Enable Colyseus web monitor dashboard at `/monitor` |
| `VAPID_PUBLIC_KEY` | *(optional)* | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | *(optional)* | Web Push VAPID private key |

---

## Testing

Backspin includes unit and integration tests covering physics determinism, netcode clock interpolation, shot reachability, Elo rating calculation, replay recording, and room lifecycle:

```bash
# Run all checks (client tests + client build + server build + server tests)
npm run check
```

---

## Production Deployment

Backspin includes a multi-stage `Dockerfile` capable of building a self-contained production image:

```bash
# Build production Docker image
docker build --target runtime -t backspin .

# Run container on port 2567 (serves static client + Colyseus API)
docker run --rm -p 2567:2567 \
  -e DATABASE_URL=postgres://user:pass@host:5432/dbname \
  -e JWT_SECRET=your-production-secret \
  -e AUTH_SALT=your-production-salt \
  backspin
```

---

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

---

## License & Credits

Original Backspin source code, documentation, and multiplayer server logic are licensed under the [MIT License](LICENSE) (see [`LICENSES/MIT.txt`](LICENSES/MIT.txt)).

Third-party assets, recovered audio/shader routines, fonts, and vendor libraries retain their respective original licenses. Please see [CREDITS.md](CREDITS.md) for full attribution and license details.
