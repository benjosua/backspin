// Recovered WebAudio system from production bundle.
import { useGameStore } from './store.js';

let audioContext = null;
let audioReady = false;
let masterGain;
let compressor;
let dryGain;
let reverb;
let reverbGain;
let noiseBuffer;
let crowdGain = null;
let music = null;
let musicGain = null;
let musicFilter = null;
let muted = false;
let wasMusicPlaying = false;
let masterVolume = 0.85;
let musicVolume = 0.1;
let musicHighpass = 20;
let menuMusicHighpass = 620;
let menuMusicVolumeFactor = 0.55;
const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT = 196;

export function noteFrequency(root, step) {
  const index = ((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  const octave = Math.floor(step / PENTATONIC.length);
  return root * 2 ** ((PENTATONIC[index] + 12 * octave) / 12);
}

const now = () => audioContext.currentTime;
const random = (min, max) => min + Math.random() * (max - min);
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

export function initAudio() {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      setupGraph();
      startGameStateAudioLoop();
      setupMuteHotkey();
    } catch {
      audioContext = null;
      return;
    }
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function setupGraph() {
  masterGain = audioContext.createGain();
  masterGain.gain.value = muted ? 0 : masterVolume;

  compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 22;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;

  dryGain = audioContext.createGain();
  reverb = audioContext.createConvolver();
  reverb.buffer = makeImpulse(1.7, 3);
  reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.5;

  dryGain.connect(compressor);
  reverb.connect(reverbGain).connect(compressor);
  compressor.connect(masterGain).connect(audioContext.destination);

  noiseBuffer = makeNoiseBuffer(0.5);
  startCrowdBed();
  setupMusic();
  audioReady = true;
}

function setupMusic() {
  if (music || !audioContext) return;
  music = new Audio('/song.mp3');
  music.loop = true;
  music.preload = 'auto';
  const source = audioContext.createMediaElementSource(music);
  musicFilter = audioContext.createBiquadFilter();
  musicFilter.type = 'highpass';
  musicFilter.frequency.value = musicHighpass;
  musicFilter.Q.value = 0.7;
  musicGain = audioContext.createGain();
  musicGain.gain.value = musicVolume;
  source.connect(musicFilter).connect(musicGain).connect(dryGain);
}

function setMusicPlaying(playing) {
  if (!music) return;
  if (playing && musicEnabled) music.play().catch(() => {});
  else if (!playing) {
    music.pause();
    music.currentTime = 0;
  }
}

let musicEnabled = true;
export function toggleMusic() {
  musicEnabled = !musicEnabled;
  setMuted(!musicEnabled);
  if (musicEnabled) {
    initAudio();
    setMusicPlaying(true);
  } else if (music) {
    music.pause();
    music.currentTime = 0;
  }
  return musicEnabled;
}

function makeNoiseBuffer(seconds) {
  const length = Math.floor(audioContext.sampleRate * seconds);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function makeImpulse(seconds, decayPower) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = audioContext.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decayPower;
  }
  return buffer;
}

function output(pan = 0, send = 0) {
  const panner = audioContext.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(dryGain);
  if (send > 0) {
    const sendGain = audioContext.createGain();
    sendGain.gain.value = send;
    panner.connect(sendGain).connect(reverb);
  }
  return panner;
}

function tone({ f, f2 = 0, type = 'sine', t0 = 0, dur = 0.12, attack = 0.003, vol = 0.2, pan = 0, send = 0 }) {
  const start = now() + t0;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, start);
  if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), start + dur);
  gain.gain.setValueAtTime(1e-4, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + attack);
  gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
  osc.connect(gain).connect(output(pan, send));
  osc.start(start);
  osc.stop(start + dur + 0.03);
  osc.onended = () => {
    try { osc.disconnect(); gain.disconnect(); } catch {}
  };
}

function noise({ t0 = 0, dur = 0.08, vol = 0.3, type = 'bandpass', freq = 1800, freq2 = 0, q = 1, pan = 0, send = 0 }) {
  const start = now() + t0;
  const src = audioContext.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = random(0.9, 1.1);
  const filter = audioContext.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, start);
  if (freq2) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq2), start + dur);
  filter.Q.value = q;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(1e-4, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.003);
  gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
  src.connect(filter).connect(gain).connect(output(pan, send));
  src.start(start);
  src.stop(start + dur + 0.03);
  src.onended = () => {
    try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch {}
  };
}

function chord(root, delay, volume, pan = 0, soft = false) {
  const partials = soft ? [[1, 1], [2, 0.22]] : [[1, 1], [2, 0.4], [3, 0.16], [4.2, 0.07]];
  for (const [multiple, amp] of partials) {
    const start = now() + delay;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = root * multiple;
    const dur = (soft ? 0.55 : 0.75) / Math.sqrt(multiple);
    gain.gain.setValueAtTime(1e-4, start);
    gain.gain.exponentialRampToValueAtTime(volume * amp, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
    osc.connect(gain).connect(output(pan, soft ? 0.22 : 0.3));
    osc.start(start);
    osc.stop(start + dur + 0.03);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch {} };
  }
}

export function playHit(power = 0, noteStep = 0) {
  if (!audioReady) return;
  const smash = power >= 0.9;
  const f = noteFrequency(ROOT, noteStep % 12) * (1 + power * 0.16);
  noise({ dur: 0.016 + power * 0.012, vol: 0.16 + power * 0.2, type: 'bandpass', freq: 2200 + power * 1600, q: 0.8, send: 0.06 });
  tone({ f, f2: f * 0.9, type: power > 0.45 ? 'triangle' : 'sine', dur: 0.06 + power * 0.03, attack: 0.002, vol: 0.18 + power * 0.12, send: 0.09 });
  if (power > 0.2) tone({ f: 150, f2: 60, dur: 0.09 + power * 0.07, vol: 0.1 + power * 0.18, send: 0.03 });
  if (smash) {
    noise({ dur: 0.14, vol: 0.3, type: 'bandpass', freq: 5200, freq2: 600, q: 0.7, send: 0.18 });
    noise({ dur: 0.03, vol: 0.34, type: 'highpass', freq: 2600, q: 0.6, send: 0.1 });
    tone({ f: 140, f2: 50, dur: 0.32, attack: 0.002, vol: 0.36, send: 0.06 });
  }
  pulseCrowd(0.4 + power * 0.6);
}

export function playBounce() {
  if (!audioReady) return;
  const f = random(150, 178);
  tone({ f: f * 1.5, f2: f, dur: 0.05, attack: 0.001, vol: 0.12, send: 0.05 });
  noise({ dur: 0.012, vol: 0.07, type: 'highpass', freq: 1500, q: 0.7 });
}

export function playNet() {
  if (!audioReady) return;
  noise({ dur: 0.12, vol: 0.16, type: 'lowpass', freq: 900, freq2: 280, q: 0.8, send: 0.04 });
  tone({ f: 150, f2: 78, type: 'triangle', dur: 0.09, vol: 0.09 });
}

export function playMenu(ok) {
  if (!audioReady) return;
  if (ok) [0, 2, 4].forEach((step, i) => chord(noteFrequency(392, step), i * 0.07, 0.13 - i * 0.012));
  else { chord(294, 0, 0.1, 0, true); chord(247, 0.12, 0.1, 0, true); }
}

export function playCharge(value) {
  if (!audioReady) return;
  tone({ f: noteFrequency(330, Math.round(clamp01(value) * 4)), dur: 0.05, attack: 0.002, vol: 0.05 + value * 0.03, send: 0.05 });
  if (value >= 0.999) tone({ f: noteFrequency(330, 5), type: 'triangle', dur: 0.13, vol: 0.08, send: 0.14 });
}

export function playGameOver(playerWon) {
  if (!audioReady) return;
  if (playerWon) [0, 1, 2, 3, 5].forEach((step, i) => chord(noteFrequency(392, step), 0.12 + i * 0.11, 0.16));
  else [5, 3, 2, 0].forEach((step, i) => chord(noteFrequency(196, step), 0.12 + i * 0.16, 0.12, 0, true));
}

function startCrowdBed() {
  const gain = audioContext.createGain();
  gain.gain.value = 0;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 640;
  filter.Q.value = 0.4;
  const lfo = audioContext.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoGain = audioContext.createGain();
  lfoGain.gain.value = 240;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  for (const [freq, detune] of [[49, -4], [73.5, 5], [98, 0], [147, 4]]) {
    const osc = audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = audioContext.createGain();
    g.gain.value = freq < 60 ? 0.5 : 0.28;
    osc.connect(g).connect(filter);
    osc.start();
  }
  filter.connect(gain).connect(dryGain);
  gain.gain.setTargetAtTime(0.028, now() + 0.4, 3);
  crowdGain = gain;
}

function pulseCrowd(amount) {
  if (!crowdGain) return;
  const t = now();
  const base = 0.028;
  crowdGain.gain.cancelScheduledValues(t);
  crowdGain.gain.setTargetAtTime(base + amount * 0.03, t, 0.04);
  crowdGain.gain.setTargetAtTime(base, t + 0.14, 0.7);
}

export function setMuted(value) {
  muted = value;
  if (masterGain) masterGain.gain.setTargetAtTime(value ? 0 : masterVolume, now(), 0.03);
}

export function toggleMute() {
  setMuted(!muted);
  return muted;
}

let hotkeyBound = false;
function setupMuteHotkey() {
  if (hotkeyBound) return;
  hotkeyBound = true;
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat) toggleMute();
  });
}

let pointerBound = false;
function bindPointerUnlock() {
  if (pointerBound) return;
  pointerBound = true;
  window.addEventListener('pointerdown', () => {
    initAudio();
    setMusicPlaying(true);
  });
}
bindPointerUnlock();

function pauseForHiddenTab() {
  wasMusicPlaying = !!(music && !music.paused);
  if (music) music.pause();
  if (audioContext?.state === 'running') audioContext.suspend().catch(() => {});
}
function resumeFromHiddenTab() {
  if (!musicEnabled || muted) return;
  if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
  if (wasMusicPlaying && music) music.play().catch(() => {});
}
let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    document.hidden ? pauseForHiddenTab() : resumeFromHiddenTab();
  });
}
bindVisibility();

let lastPhase = 'serve';
let wasMenuOpen = false;
function startGameStateAudioLoop() {
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!audioReady) return;
    const state = useGameStore.getState();
    if (state.phase === 'over' && lastPhase !== 'over') playGameOver(state.winner === 'player');
    lastPhase = state.phase;
    const menuOpen = state.started && state.menuOpen && state.phase !== 'over';
    if (menuOpen !== wasMenuOpen) {
      const lag = 0.14;
      if (musicFilter) musicFilter.frequency.setTargetAtTime(menuOpen ? menuMusicHighpass : musicHighpass, now(), lag);
      if (musicGain) musicGain.gain.setTargetAtTime(musicVolume * (menuOpen ? menuMusicVolumeFactor : 1), now(), lag);
      playTransition(menuOpen);
      wasMenuOpen = menuOpen;
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

function playTransition(opening) {
  if (!audioReady) return;
  const start = now();
  const dur = opening ? 0.55 : 0.4;
  const src = audioContext.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = random(0.95, 1.06);
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.85;
  filter.frequency.setValueAtTime(opening ? 1500 : 480, start);
  filter.frequency.exponentialRampToValueAtTime(opening ? 360 : 1700, start + dur);
  const gain = audioContext.createGain();
  const vol = opening ? 0.18 : 0.12;
  gain.gain.setValueAtTime(1e-4, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + dur * 0.3);
  gain.gain.exponentialRampToValueAtTime(1e-4, start + dur);
  src.connect(filter).connect(gain).connect(output(0, 0.45));
  src.start(start);
  src.stop(start + dur + 0.05);
  src.onended = () => { try { src.disconnect(); filter.disconnect(); gain.disconnect(); } catch {} };
}
