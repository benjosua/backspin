// Recovered DOM HUD stack from production bundle names `Jj`, `dM`, `hM` and helpers.

import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import { BOTS, COLORS, PADDLES } from '../constants.js';
import { inputHud } from '../engine.js';
import { networkGame } from '../network.js';
import { toggleMusic } from '../audio.js';
import { useGameStore } from '../store.js';

const MATCH_TO = 11;
const padScore = (value) => String(value).padStart(2, '0');
const dialRadius = 30;
const dialCircumference = Math.PI * 2 * dialRadius;
const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function stop(event) {
  event.stopPropagation();
}

export function ChargeDial() {
  const arc = useRef(null);
  const dot = useRef(null);
  const label = useRef(null);
  const dial = useRef(null);
  const callout = useRef(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (arc.current) {
        arc.current.style.strokeDashoffset = dialCircumference * (1 - inputHud.charge);
        arc.current.style.opacity = 0.35 + inputHud.charge * 0.65;
      }
      if (dot.current) {
        dot.current.style.transform = `translate(${inputHud.spinX * 14}px, ${-inputHud.spinY * 14}px)`;
        dot.current.style.opacity = inputHud.spinMag > 0.05 ? 0.9 : 0.18;
      }
      if (dial.current) dial.current.style.transform = `scale(${inputHud.charge >= 1 ? 1.06 : 1})`;
      if (label.current) {
        if (inputHud.charging && inputHud.charge > 0.02) label.current.textContent = `${Math.round(inputHud.charge * 100)}%`;
        else if (inputHud.spinMag > 0.05 && inputHud.spinLabel) label.current.textContent = inputHud.spinLabel;
        else label.current.textContent = 'SPIN';
      }
      if (callout.current) {
        const t = inputHud.calloutT / 0.9;
        callout.current.textContent = inputHud.callout;
        callout.current.style.color = inputHud.calloutColor || COLORS.ai;
        callout.current.style.opacity = inputHud.calloutT > 0 ? Math.min(1, t * 2.4) : 0;
        callout.current.style.transform = `translate(-50%,-50%) scale(${1 + (1 - t) * 0.14})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <div className="dial" ref={dial}>
        <svg viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r={dialRadius} className="dial-track" />
          <circle ref={arc} cx="40" cy="40" r={dialRadius} className="dial-arc" style={{ strokeDasharray: dialCircumference, strokeDashoffset: dialCircumference }} />
        </svg>
        <span ref={dot} className="dial-dot" />
        <span ref={label} className="dial-label">SPIN</span>
      </div>
      <div className="callout" ref={callout} />
    </>
  );
}

export function DifficultyButtons() {
  const difficulty = useGameStore((state) => state.difficulty);
  const mode = useGameStore((state) => state.mode);
  const networkStatus = useGameStore((state) => state.networkStatus);
  const roomCode = useGameStore((state) => state.roomCode);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  return (
    <div className="seg">
      {BOTS.map((bot) => (
        <button key={bot.id} className={`seg-btn ${bot.id === difficulty ? 'on' : ''}`} onClick={() => setDifficulty(bot.id)} title={bot.tag}>
          {bot.name}
        </button>
      ))}
    </div>
  );
}

export function PaddleButtons() {
  const paddle = useGameStore((state) => state.paddle);
  const setPaddle = useGameStore((state) => state.setPaddle);
  return (
    <div className="paddle-row">
      {PADDLES.map((item) => (
        <button key={item.id} className={`paddle-card ${item.id === paddle ? 'on' : ''}`} onClick={() => setPaddle(item.id)} title={item.tag} style={{ '--accent': item.colors.edge }}>
          <span className="pc-swatch" style={{ background: `radial-gradient(circle at 50% 38%, ${item.colors.accent}, ${item.colors.core} 52%, ${item.colors.edge})` }} />
          <span className="pc-name">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

export function SoundButton() {
  const [enabled, setEnabled] = useState(true);
  const className = `sound-btn ${enabled ? '' : 'muted'}`;
  return (
    <button
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        setEnabled(toggleMusic());
      }}
      onPointerDown={stop}
      onPointerUp={stop}
      aria-label={enabled ? 'turn sound off' : 'turn sound on'}
      title={enabled ? 'sound off' : 'sound on'}
    >
      <svg viewBox="0 0 30 14">
        <path className="sw-wave" d="M-7 7 Q -5 1, -3 7 T 1 7 T 5 7 T 9 7 T 13 7 T 17 7 T 21 7 T 25 7 T 29 7 T 33 7 T 37 7 T 41 7" />
        <path className="sw-flat" d="M1 7 L 29 7" />
      </svg>
    </button>
  );
}


export function ModePicker() {
  const started = useGameStore((state) => state.started);
  const revealed = useGameStore((state) => state.revealed);
  const networkStatus = useGameStore((state) => state.networkStatus);
  const networkError = useGameStore((state) => state.networkError);
  const roomCode = useGameStore((state) => state.roomCode);
  const start = useGameStore((state) => state.start);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (started || !revealed) return null;
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return (
    <div className="mode-picker" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className="mode-title">MODE</div>
      <div className="mode-row">
        <button onClick={start} disabled={busy}>OFFLINE</button>
        <button onClick={() => run(() => networkGame.quickMatch())} disabled={busy}>QUICK MATCH</button>
      </div>
      <div className="mode-row private">
        <button onClick={() => run(() => networkGame.createPrivate())} disabled={busy}>CREATE ROOM</button>
        <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CODE" maxLength={8} />
        <button onClick={() => run(() => networkGame.joinPrivate(code))} disabled={busy || !code.trim()}>JOIN CODE</button>
      </div>
      {networkStatus === 'connecting' && <div className="mode-status">CONNECTING...</div>}
      {networkStatus === 'waiting' && <div className="mode-status">SEARCHING... {roomCode}</div>}
      {networkError && <div className="mode-error">{networkError}</div>}
    </div>
  );
}

export function Hud() {
  const started = useGameStore((state) => state.started);
  const scoreP = useGameStore((state) => state.scoreP);
  const scoreAI = useGameStore((state) => state.scoreAI);
  const phase = useGameStore((state) => state.phase);
  const server = useGameStore((state) => state.server);
  const flashText = useGameStore((state) => state.flashText);
  const flashColor = useGameStore((state) => state.flashColor);
  const flashId = useGameStore((state) => state.flashId);
  const winner = useGameStore((state) => state.winner);
  const menuOpen = useGameStore((state) => state.menuOpen);
  const toggleMenu = useGameStore((state) => state.toggleMenu);
  const goHome = useGameStore((state) => state.goHome);
  const newGame = useGameStore((state) => state.newGame);
  const difficulty = useGameStore((state) => state.difficulty);
  const mode = useGameStore((state) => state.mode);
  const networkStatus = useGameStore((state) => state.networkStatus);
  const roomCode = useGameStore((state) => state.roomCode);

  const bot = BOTS.find((item) => item.id === difficulty) ?? BOTS[1];
  const botName = bot.name;
  const opponentName = mode === 'online' ? 'OPPONENT' : botName;
  const playerWon = winner === 'player';
  const delta = Math.abs(scoreP - scoreAI);
  const flavor = playerWon
    ? difficulty === 'rookie'
      ? 'WARMED UP — PRO IS WAITING'
      : difficulty === 'pro'
        ? 'SHARP — THE MASTER AWAITS'
        : 'FLAWLESS — NOTHING LEFT TO PROVE'
    : delta <= 2
      ? 'SO CLOSE — RUN IT BACK'
      : `THE ${botName} HAD YOUR NUMBER`;
  const firstServe = phase === 'serve' && scoreP === 0 && scoreAI === 0;
  const serveMessage = mode === 'online' && networkStatus === 'waiting'
    ? 'WAITING FOR OPPONENT'
    : phase === 'serve' ? (server === 'player' ? 'HOLD · RELEASE TO SERVE' : `${opponentName} SERVES`) : '';

  return (
    <div className="hud">
      {started && menuOpen && phase !== 'over' && <div className="pause-veil" aria-hidden />}

      {started && (
        <>
          <div className="top">
            <div className="match">MATCH TO {MATCH_TO}</div>
            <div className="scoreboard">
              <div className={`side ${server === 'player' ? 'serving' : ''}`}>
                <span className="lbl you">YOU</span>
                <span className="num">{padScore(scoreP)}</span>
              </div>
              <span className="sep">|</span>
              <div className={`side ${server === 'ai' ? 'serving' : ''}`}>
                <span className="lbl cpu">{opponentName}</span>
                <span className="num">{padScore(scoreAI)}</span>
              </div>
            </div>
            <div className="pips">
              <i className={server === 'player' ? 'on you' : ''} />
              <i className={server === 'ai' ? 'on cpu' : ''} />
            </div>
          </div>
          {mode === 'online' && roomCode && <div className="room-code">ROOM&nbsp;{roomCode}</div>}
          {serveMessage && <div className="serve-msg">{serveMessage}</div>}
          {flashText && phase !== 'over' && (
            <div key={flashId} className="flash" style={{ color: flashColor, textShadow: `0 0 30px ${flashColor}55` }}>
              {flashText}
            </div>
          )}
          <ChargeDial />
          {firstServe && <div className="hint">HOLD&nbsp;CHARGE&nbsp;·&nbsp;FLICK&nbsp;SPIN&nbsp;·&nbsp;HIT&nbsp;HIGH&nbsp;TO&nbsp;SMASH</div>}
          {!isCoarsePointer && phase !== 'over' && !menuOpen && (
            <div className="esc-hint" aria-hidden>
              <kbd>ESC</kbd>
              <span>PAUSE</span>
            </div>
          )}
        </>
      )}

      <button
        className={`menu-btn ${menuOpen ? 'open' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
        onPointerDown={stop}
        onPointerUp={stop}
        aria-label={menuOpen ? 'close menu' : 'menu'}
      >
        <span />
        <span />
        <span />
      </button>

      {menuOpen && (
        <div className="panel">
          <h3>{started ? 'PAUSED' : 'CONTROLS'}</h3>
          <ul>
            <li><b>Move</b><span>{isCoarsePointer ? 'Drag' : 'Mouse · A / D'}</span></li>
            <li><b>Charge power</b><span>{isCoarsePointer ? 'Hold' : 'Hold mouse · Space'}</span></li>
            <li><b>Spin</b><span>{isCoarsePointer ? 'Flick at contact' : 'Flick at contact · W / S'}</span></li>
            <li><b>Smash</b><span>Hit a high ball</span></li>
            <li><b>Serve</b><span>Release</span></li>
            {!isCoarsePointer && <li><b>Pause · back</b><span>Esc</span></li>}
          </ul>
          {started && mode !== 'online' && <button onClick={newGame}>RESTART&nbsp;GAME</button>}
          {started && <button onClick={() => { if (mode === 'online') networkGame.disconnect(); else goHome(); }}>EXIT&nbsp;TO&nbsp;LOBBY</button>}
          <button onClick={toggleMenu}>{started ? 'RESUME' : 'CLOSE'}</button>
        </div>
      )}

      {phase === 'over' && (
        <div className={`over ${playerWon ? 'win' : 'lose'}`}>
          <div className="over-kicker">{playerWon ? 'GAME · SET · MATCH' : 'MATCH OVER'}</div>
          <div className="over-title">{playerWon ? 'YOU WIN' : `${opponentName} WINS`}</div>
          <div className="over-score">
            <div className="os-side"><span className="os-lbl">YOU</span><span className="os-num os-you">{scoreP}</span></div>
            <span className="os-sep">—</span>
            <div className="os-side"><span className="os-lbl">{opponentName}</span><span className="os-num os-cpu">{scoreAI}</span></div>
          </div>
          <div className="over-flavor">{flavor}</div>
          <div className="over-next">
            <div className="over-card">
              <div className="over-pick">NEXT OPPONENT</div>
              <DifficultyButtons />
              <div className="over-pick pad">YOUR PADDLE</div>
              <PaddleButtons />
            </div>
            <div className="over-actions">
              {mode !== 'online' && <button className="rematch" onClick={newGame}>REMATCH&nbsp;·&nbsp;{botName}</button>}
              <button className="over-home" onClick={() => { if (mode === 'online') networkGame.disconnect(); else goHome(); }}>↩&nbsp;&nbsp;HOME</button>
            </div>
          </div>
        </div>
      )}

      <SoundButton />
    </div>
  );
}

export function PointerCursor() {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const node = ref.current;
      if (node) {
        node.style.transform = `translate3d(${inputHud.cursorX}px, ${inputHud.cursorY}px, 0)`;
        node.style.opacity = inputHud.cursorVisible ? '1' : '0';
        const charge = inputHud.charging ? inputHud.charge : 0;
        node.style.setProperty('--pc-charge', charge.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className="pointer-cursor" aria-hidden>
      <span className="pc-glow" />
      <span className="pc-ring" />
      <span className="pc-core" />
      <span className="pc-dot" />
    </div>
  );
}

const loadedExitMinMs = 2400;
const maxIntroMs = 10000;
const introRemoveDelayMs = 1100;

export function IntroOverlay() {
  const { active, progress } = useProgress();
  const reveal = useGameStore((state) => state.reveal);
  const [leaving, setLeaving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const startTime = useRef(0);

  useEffect(() => {
    startTime.current = performance.now();
  }, []);

  const loaded = !active && progress >= 100;
  useEffect(() => {
    if (leaving) return undefined;
    const elapsed = performance.now() - startTime.current;
    const delay = loaded ? Math.max(0, loadedExitMinMs - elapsed) : Math.max(0, maxIntroMs - elapsed);
    const timer = setTimeout(() => {
      setLeaving(true);
      reveal();
    }, delay);
    return () => clearTimeout(timer);
  }, [loaded, leaving, reveal]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => setRemoved(true), introRemoveDelayMs);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (removed) return null;
  const percent = Math.round(loaded ? 100 : progress);
  const width = `${percent}%`;

  return (
    <div className={leaving ? 'intro intro-leave' : 'intro'}>
      <div className="intro-title" aria-label="RALLY">
        {'RALLY'.split('').map((letter, index) => (
          <span key={index} style={{ animationDelay: `${0.25 + index * 0.09}s` }}>{letter}</span>
        ))}
      </div>
      <div className="intro-sub">TABLE TENNIS</div>
      <div className="intro-load"><div className="intro-load-fill" style={{ width }} /></div>
    </div>
  );
}
