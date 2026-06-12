// Recovered DOM HUD stack from production bundle names `Jj`, `dM`, `hM` and helpers.

import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import { BOTS, COLORS, PLAYER_SPEED } from '../constants.js';
import { inputHud } from '../engine.js';
import { networkGame } from '../network.js';
import { RENDER_SCALES, useGameStore } from '../store.js';

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
  const aim = useRef(null);

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
      if (aim.current) {
        const spin = Math.hypot(inputHud.spinX, inputHud.spinY);
        aim.current.textContent = `AIM ${inputHud.aimLabel || 'CENTER · MID'} · SPIN ${Math.round(spin * 100)} · POWER ${Math.round(inputHud.charge * 100)}`;
        aim.current.style.opacity = inputHud.charging ? 0.95 : 0.35;
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
      <div className="aim-readout" ref={aim}>AIM CENTER · MID · SPIN 0 · POWER 0</div>
      <div className="callout" ref={callout} />
    </>
  );
}

export function DifficultyButtons() {
  const difficulty = useGameStore((state) => state.difficulty);
  const mode = useGameStore((state) => state.mode);
  const networkStatus = useGameStore((state) => state.networkStatus);
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



export function PlayerSpeedSetting() {
  const playerSpeed = useGameStore((state) => state.playerSpeed);
  const setPlayerSpeed = useGameStore((state) => state.setPlayerSpeed);
  return (
    <label className="speed-setting" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <span>PLAYER SPEED</span>
      <input
        type="number"
        min={Math.round(PLAYER_SPEED.min * 100)}
        max={Math.round(PLAYER_SPEED.max * 100)}
        step="5"
        value={Math.round(playerSpeed * 100)}
        onChange={(event) => setPlayerSpeed(Number(event.target.value) / 100)}
        aria-label="player speed percent"
      />
      <em>%</em>
    </label>
  );
}

export function PerformanceSettings() {
  const performancePrefs = useGameStore((state) => state.performancePrefs);
  const setPerformancePref = useGameStore((state) => state.setPerformancePref);
  return (
    <div className="perf-settings" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className="perf-title">PERFORMANCE</div>
      <div className="perf-row">
        <span>RENDER SCALE</span>
        <div className="perf-seg">
          {Object.entries(RENDER_SCALES).map(([key, value]) => (
            <button
              key={key}
              type="button"
              className={performancePrefs.renderScale === key ? 'on' : ''}
              onClick={() => setPerformancePref('renderScale', key)}
            >
              {value.label}
            </button>
          ))}
        </div>
      </div>
      <label className="perf-toggle">
        <span>EXTRA FX</span>
        <input
          type="checkbox"
          checked={performancePrefs.extraFx}
          onChange={(event) => setPerformancePref('extraFx', event.target.checked)}
        />
      </label>
    </div>
  );
}

export function ModePicker() {
  const started = useGameStore((state) => state.started);
  const revealed = useGameStore((state) => state.revealed);
  const networkStatus = useGameStore((state) => state.networkStatus);
  const networkError = useGameStore((state) => state.networkError);
  const playerName = useGameStore((state) => state.playerName);
  const authUser = useGameStore((state) => state.authUser);
  const rankedProfile = useGameStore((state) => state.rankedProfile);
  const leaderboard = useGameStore((state) => state.leaderboard);
  const rankedQueueCount = useGameStore((state) => state.rankedQueueCount);
  const setPlayerName = useGameStore((state) => state.setPlayerName);
  const setNetworkStatus = useGameStore((state) => state.setNetworkStatus);
  const start = useGameStore((state) => state.start);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const joinAttemptedCode = useRef('');
  const run = async (fn) => {
    setBusy(true);
    try {
      setNetworkStatus(networkStatus === 'waiting' ? 'waiting' : 'idle');
      await fn();
    } catch (error) {
      setNetworkStatus('disconnected', error?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };
  const updateCode = (value) => setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5));
  useEffect(() => {
    networkGame.refreshLeaderboard().catch(() => {});
  }, []);
  useEffect(() => {
    if (!authUser || authUser.name === playerName) return;
    const timeout = setTimeout(() => {
      networkGame.updateAccountName(playerName).catch(() => {});
    }, 350);
    return () => clearTimeout(timeout);
  }, [authUser, playerName]);
  useEffect(() => {
    if (code.length < 5) {
      joinAttemptedCode.current = '';
      return;
    }
    if (busy || joinAttemptedCode.current === code) return;
    joinAttemptedCode.current = code;
    run(() => networkGame.joinPrivate(code));
  }, [code, busy]);
  if (started || !revealed) return null;
  return (
    <div className="mode-picker" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className="mode-title">MODE</div>
      <div className="mode-row name">
        <input
          className="player-name-input"
          value={playerName}
          onChange={(event) => setPlayerName(event.target.value)}
          placeholder="NAME"
          maxLength={12}
          aria-label="player name"
        />
      </div>
      <div className="auth-box">
        {authUser ? (
          <>
            <div className="auth-status">
              <b>{authUser.name}</b>
              <span>{rankedProfile ? `${rankedProfile.rating} ELO · ${rankedProfile.wins}-${rankedProfile.losses}` : 'RANK LOADING'}</span>
            </div>
            <button onClick={() => run(() => networkGame.signOut())} disabled={busy}>LOG OUT</button>
          </>
        ) : (
          <>
            <div className="mode-row auth-inputs">
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" aria-label="email" />
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="PASSWORD" type="password" aria-label="password" />
            </div>
            <div className="mode-row">
              <button onClick={() => run(() => networkGame.signIn(email, password))} disabled={busy || !email || !password}>SIGN IN</button>
              <button onClick={() => run(() => networkGame.register(email, password))} disabled={busy || !email || !password}>REGISTER</button>
            </div>
          </>
        )}
      </div>
      <div className="mode-row">
        <button onClick={start} disabled={busy}>OFFLINE</button>
        <button onClick={() => run(() => networkGame.quickMatch())} disabled={busy}>QUICK MATCH</button>
        <button onClick={() => run(() => networkGame.rankedMatch())} disabled={busy || !authUser}>RANKED</button>
      </div>
      <div className="mode-row private">
        <button onClick={() => run(() => networkGame.createPrivate())} disabled={busy}>CREATE ROOM</button>
        <input value={code} onChange={(event) => updateCode(event.target.value)} placeholder="CODE" maxLength={5} />
      </div>
      {networkStatus === 'connecting' && <div className="mode-status">CONNECTING...</div>}
      {networkStatus === 'waiting' && <div className="mode-status">SEARCHING{rankedQueueCount ? ` · ${rankedQueueCount}/2` : ''}</div>}
      {networkError && <div className="mode-error">{networkError}</div>}
      <div className="leaderboard">
        <div className="leaderboard-title">LEADERBOARD</div>
        {(leaderboard || []).slice(0, 5).map((entry) => (
          <div className="leaderboard-row" key={entry.userId}>
            <span>#{entry.rank}</span>
            <b>{entry.name}</b>
            <em>{entry.rating}</em>
          </div>
        ))}
        {(!leaderboard || leaderboard.length === 0) && <div className="leaderboard-empty">NO RANKED MATCHES YET</div>}
      </div>
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
  const playerName = useGameStore((state) => state.playerName);
  const onlineOpponentName = useGameStore((state) => state.opponentName);

  const bot = BOTS.find((item) => item.id === difficulty) ?? BOTS[1];
  const botName = bot.name;
  const youName = playerName || 'PLAYER';
  const opponentName = mode === 'online' ? (onlineOpponentName || 'OPPONENT') : botName;
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
                <span className="lbl you">{youName}</span>
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
          {serveMessage && <div className="serve-msg">{serveMessage}</div>}
          {flashText && phase !== 'over' && (
            <div key={flashId} className="flash" style={{ color: flashColor, textShadow: `0 0 30px ${flashColor}55` }}>
              {flashText}
            </div>
          )}
          <ChargeDial />
          {firstServe && <div className="hint">MOVE&nbsp;TO&nbsp;AIM&nbsp;·&nbsp;HOLD&nbsp;CHARGE&nbsp;·&nbsp;FLICK&nbsp;SPIN</div>}
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
            <li><b>Move</b><span>{isCoarsePointer ? 'Drag' : 'A / D'}</span></li>
            <li><b>Aim landing</b><span>{isCoarsePointer ? 'Move across table' : 'Mouse'}</span></li>
            <li><b>Charge power</b><span>{isCoarsePointer ? 'Hold' : 'Hold mouse · Space'}</span></li>
            <li><b>Spin</b><span>{isCoarsePointer ? 'Flick at contact' : 'W / S'}</span></li>
            <li><b>Smash</b><span>Charge a high ball</span></li>
            <li><b>Serve</b><span>Release</span></li>
            {!isCoarsePointer && <li><b>Pause · back</b><span>Esc</span></li>}
          </ul>
          <PlayerSpeedSetting />
          <PerformanceSettings />
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
            <div className="os-side"><span className="os-lbl">{youName}</span><span className="os-num os-you">{scoreP}</span></div>
            <span className="os-sep">—</span>
            <div className="os-side"><span className="os-lbl">{opponentName}</span><span className="os-num os-cpu">{scoreAI}</span></div>
          </div>
          <div className="over-flavor">{flavor}</div>
          <div className="over-next">
            <div className="over-card">
              <div className="over-pick">NEXT OPPONENT</div>
              <DifficultyButtons />
            </div>
            <div className="over-actions">
              {mode !== 'online' && <button className="rematch" onClick={newGame}>REMATCH&nbsp;·&nbsp;{botName}</button>}
              <button className="over-home" onClick={() => { if (mode === 'online') networkGame.disconnect(); else goHome(); }}>↩&nbsp;&nbsp;HOME</button>
            </div>
          </div>
        </div>
      )}
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

  return (
    <div className={leaving ? 'intro intro-leave' : 'intro'}>
      <div className="intro-title" aria-label="BACKSPIN">
        {'BACKSPIN'.split('').map((letter, index) => (
          <span key={index} style={{ animationDelay: `${0.25 + index * 0.09}s` }}>{letter}</span>
        ))}
      </div>
    </div>
  );
}
