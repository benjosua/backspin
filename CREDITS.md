# Credits

Backspin bundles and adapts third-party assets, fonts, vendor packages, and recovered components. Original Backspin source code, documentation, authoritative server architecture, client prediction algorithms, and other project-created content are licensed under the MIT License (see [LICENSE](./LICENSE)), but the assets and components below retain their original licenses and attribution.

This file exists so redistribution stays compliant and original creators receive appropriate credit.

---

## Recovered & Adapted Components

### WebAudio Procedural Synthesizer & Sound Effects
- **Component:** Dynamic procedural WebAudio system and DSP graph (`src/audio.js`)
- **Description:** Real-time WebAudio nodes generating pitch-shifted hits, table bounces, charging hums, dynamic impulse convolver reverb, and point resolution audio.
- **Notes:** Adapted and recovered procedural audio system.

### GLSL Custom Shaders
- **Component:** Paddle vertex & fragment shaders (`src/shaders.js`)
- **Description:** GLSL shaders handling normal transformations, Fresnel rim lighting, dynamic charge overlays, energy pulses, and impact flashes.
- **Notes:** Adapted and recovered shader routines.

---

## Fonts & Typography

### Montserrat
- **Designers:** Julieta Ulanovsky, Sol Matas, Juan Pablo del Peral, Jacques Le Bailly
- **Usage:** 3D in-game rendered typography loaded via `src/fonts.js`
- **License:** SIL Open Font License 1.1 - see [`LICENSES/OFL-1.1.txt`](./LICENSES/OFL-1.1.txt)

### Inter
- **Designer:** Rasmus Andersson
- **Usage:** UI typography via `@fontsource-variable/inter`
- **License:** SIL Open Font License 1.1

---

## Vendor Data & Libraries

### Unicode Font Resolver
- **Source:** Troika Three Text (`troika-three-text` by Protect Wisdom)
- **Files:** `public/vendor/unicode-font-resolver/`
- **License:** Apache License 2.0 - see [`LICENSES/APACHE-2.0.txt`](./LICENSES/APACHE-2.0.txt)

### Open Source Ecosystem
Backspin builds upon amazing open-source projects:
- **[Three.js](https://threejs.org/)** & **[@react-three/fiber](https://r3f.docs.pmnd.rs/)** (MIT) - 3D scene rendering and camera pipelines
- **[Colyseus](https://colyseus.io/)** (MIT / Apache-2.0) - Authoritative multiplayer room state synchronization and matchmaking
- **[Lucide Icons](https://lucide.dev/)** (ISC) - Iconography for menus and HUD
