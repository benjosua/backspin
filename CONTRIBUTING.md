# Contributing to Backspin

Thank you for your interest in contributing to Backspin! Whether you are fixing a bug, adding new gameplay features, improving netcode physics, or refining documentation, your help is warmly welcome.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Project Architecture](#project-architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Running with Docker Compose (Recommended)](#running-with-docker-compose-recommended)
  - [Running Locally](#running-locally)
- [Running Tests & Checks](#running-tests--checks)
- [Development Guidelines](#development-guidelines)
  - [Shared Physics & Core Rules](#shared-physics--core-rules)
  - [Client Prediction & Netcode](#client-prediction--netcode)
- [Submitting Changes](#submitting-changes)
  - [Branch Naming](#branch-naming)
  - [Commit Messages](#commit-messages)
  - [Pull Request Checklist](#pull-request-checklist)

---

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Project Architecture

Backspin is organized into a modular monorepo structure:

```
backspin/
├── src/                      # Frontend client (React, Three.js / React Three Fiber, Vite, Zustand)
│   ├── components/           # UI and 3D Canvas scenes (Scene, Actors, Hud, MobileControls, etc.)
│   ├── engine.js             # Local physics & game loop
│   ├── network.js            # Colyseus client connection & synchronization
│   ├── network-rendering.js  # Prediction, latency compensation & interpolation
│   └── store.js              # Zustand game state
│
├── serve/                 # Authoritative Game Server (Colyseus, Express, TypeScript)
│   ├── src/
│   │   ├── shared/           # Pure shared game physics, geometry, and rules (used by BOTH client & server)
│   │   ├── rooms/            # Colyseus room definitions (BackspinRoom, RankedQueueRoom, SocialRoom)
│   │   ├── ranked/           # Ranked matchmaking, Elo rating, and profile store
│   │   ├── matches/          # Match records, frame-by-frame and shot replay persistence
│   │   ├── social/           # Friends, game invites, push notifications (Web Push)
│   │   └── simulated-players/# Bot population worker (simulates realistic online activity curves)
│   └── test/                 # Server test suite (Mocha + TSX + PostgreSQL)
│
├── test/                     # Client unit tests (Node.js test runner)
└── docker-compose.yml        # Multi-service local dev environment
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.9.0` or higher
- **npm**: `v10.0.0` or higher
- **Docker & Docker Compose** (optional but recommended for database and containerized workflows)

### Running with Docker Compose (Recommended)

The easiest way to start all services (Client + Game Server + PostgreSQL + Simulated Players) with hot-reloading:

```bash
# Start all services
npm run docker:up
# Or: docker compose up --watch --build
```

- Client: [http://localhost:5173](http://localhost:5173)
- Server: [http://localhost:2567](http://localhost:2567)

### Running Locally

1. **Install dependencies:**
   ```bash
   npm install
   npm --prefix serve install
   ```

2. **Start a PostgreSQL database** (or use the test container):
   ```bash
   docker compose up -d postgres
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   cp serve/.env.example serve/.env
   ```

4. **Start the server:**
   ```bash
   npm --prefix serve run start
   ```


5. **Start the client:**
   ```bash
   npm run dev
   ```

---

## Running Tests & Checks

Before submitting any code, verify that all tests and builds pass:

```bash
# Run the full validation suite (client tests, frontend build, server build, server tests)
npm run check
```

You can also run individual suites:

```bash
# Run client unit tests
npm run client:test

# Run server unit & integration tests (requires PostgreSQL or Docker)
npm run server:test

# Build client bundle
npm run build

# Build server TypeScript
npm run server:build
```

---

## Development Guidelines

### Shared Physics & Core Rules

- The [`serve/src/shared/`](serve/src/shared) directory contains pure functions for ball trajectory, racket collision detection, spin mechanics, serve rotation, and bot targeting.
- **Rule:** Never import DOM, window, or Three.js-specific rendering objects into `serve/src/shared/`. These modules must remain 100% deterministic and pure so both the client and authoritative server calculate identical physics.

### Client Prediction & Netcode

- Backspin utilizes authoritative server state with client-side prediction, visual latency lead extrapolation, and smooth correction decays.
- Check [`src/network-rendering.js`](src/network-rendering.js) and [`src/network.js`](src/network.js) when tweaking netcode interpolation or visual contact effects.

---

## Submitting Changes

### Branch Naming

- `feature/description` (e.g., `feature/tournament-mode`)
- `fix/description` (e.g., `fix/paddle-collision-bounds`)
- `perf/description` (e.g., `perf/replay-frame-compression`)
- `docs/description` (e.g., `docs/architecture-guide`)

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add spectator mode to custom rooms`
- `fix: resolve paddle hitbox extrapolation glitch`
- `perf: optimize frame buffer serialization`
- `docs: update deployment environment variables`
- `test: add unit test for deuce serve rotation`

### Pull Request Checklist

When opening a Pull Request:
1. Ensure all tests pass with `npm run check`.
2. Add unit tests for new features or bug fixes whenever applicable.
3. Keep PRs focused on a single concern or feature.
4. Update relevant documentation if modifying environment variables or configuration options.
