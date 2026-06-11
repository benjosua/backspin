# Recovered-source feature audit

Date: 2026-06-11
Scope: `/recovered-src` compared against `recovered-webcrack-nojsx/app-only.deobfuscated.js` app root `bK()`.

## Present in recovered source

- Exact static deployed replica still exists via `/index.html` + `/public/assets/index-DXcVVo4s.js`.
- Recovered source test entry: `/recovered.html`.
- Core game state/store: `recovered-src/store.js`.
- Gameplay engine: `recovered-src/engine.js`.
- WebAudio/music/sfx: `recovered-src/audio.js`.
- FX state: `recovered-src/fx-state.js`.
- GLSL shaders: `recovered-src/shaders.js`.
- Scene/lights/models/table/background: `recovered-src/components/Scene.jsx`.
- Actors/ball/paddles/net/particles/confetti: `recovered-src/components/Actors.jsx`.
- 3D intro/lobby: `recovered-src/components/IntroMenu3D.jsx`.
- DOM HUD, pause panel, game over UI, cursor, loading overlay: `recovered-src/components/Hud.jsx`.
- Postprocessing bloom + AGX tone map: `recovered-src/components/Postprocessing.jsx`.
- Recovered root and entrypoint: `recovered-src/App.jsx`, `recovered-src/main.jsx`.
- Local Troika unicode font data: configured via `configureTextBuilder(...)`.

## Missing / partial vs original bundle

### 1. 3D wall scoreboard text from `EE` — restored
Original `EE` renders:
- Back-wall shader plane.
- 3D score text for player and CPU using Troika Text.
- `YOU` and opponent labels.
- Center divider line.
- Serve dot.
- Score pop animation when a point changes.
- Breathing/heat animation.
- Label highlight based on current server.

Recovered source now has:
- Back-wall shader plane (`SkyWall`).
- `WallScoreboard` with Troika 3D player/CPU scores, labels, divider, serve dot, score pop, breathing/heat animation.
- DOM scoreboard override removed; deployed CSS hides DOM `.top` again, matching original.

### 2. Wall win/loss wash uniforms from `EE` — restored
`SkyWall` now updates `uWin` and `uWinFlash` from store `phase/winner`.

### 3. Mobile/desktop gate `xM` — restored
Original app wraps root in `xM`, which blocks coarse pointer or width <= 640px with:
- `RALLY`
- `This is a desktop-only experiment.`
- `Open on a computer to play.`

Recovered source now has `DesktopOnlyGate`, matching original text and breakpoint behavior.

### 4. Debug tuning panel `gK` + Leva root — missing
Original app includes hidden `?debug` panel with folders for:
- Match Over trigger win/lose.
- World tuning.
- Table tuning.
- Background ring tuning.
- Sky colors.
- Lighting.
- Postprocessing.
- Net.
- Ball trail.
- Menu.
- Scoreboard.

Recovered source honors `DEBUG_MODE` partly in store/camera but no Leva controls/UI.

Impact:
- Normal users unaffected.
- Debug/tuning workflow not restored.

### 5. Source-mode CSS override — cleared
`recovered-src/recovered-overrides.css` remains linked but contains no active override now that 3D wall score is restored.

## Recently fixed recovery mismatches

- Player flick side-spin used wrong constant:
  - Wrong: `PHYSICS.magnus` (`7.5`).
  - Correct original equivalent: `CAMERA.cameraZBase` (`0.34`).
- Recovered source used old `/src/styles.css` instead of deployed CSS. Fixed `recovered.html` to load `/assets/index-BzZ6c66z.css` plus override.
- Source-mode Troika font data hit jsDelivr. Fixed via `configureTextBuilder` local vendor URL.

## Priority next work

1. Optionally recover `gK` debug/Leva tuning panel.
2. Interactive playtest: intro -> start -> serve charge -> rally -> point -> score pop -> game over.
3. Promote recovered source from `/recovered.html` to main app entry once playtest passes.
