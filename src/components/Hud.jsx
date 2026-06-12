// Recovered DOM HUD stack from production bundle names `Jj`, `dM`, `hM` and helpers.

import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import { BOTS, COLORS, PLAYER_SPEED, TABLE } from '../constants.js';
import { inputHud } from '../engine.js';
import { fetchMyMatches, fetchMyStats, networkGame } from '../network.js';
import { replayGame } from '../replay.js';
import { DEBUG_MODE, RENDER_SCALES, useGameStore } from '../store.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const MATCH_TO = 11;
const padScore = (value) => String(value).padStart(2, '0');
const dialRadius = 30;
const dialCircumference = Math.PI * 2 * dialRadius;
const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const glassPanel = 'pointer-events-auto rounded-3xl border bg-popover/90 p-6 text-popover-foreground shadow-xl ring-1 ring-foreground/5 backdrop-blur-md';
const labelText = 'text-[10px] font-medium uppercase tracking-[0.34em] text-muted-foreground';
const row = 'flex flex-wrap items-center justify-center gap-2';
const statBox = 'rounded-2xl border bg-background/70 p-3 shadow-sm';
const activeButton = 'bg-primary text-primary-foreground hover:bg-primary/90';

function stop(event) {
  event.stopPropagation();
}

function formatReplayDate(value) {
  if (!value) return 'LIVE';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatReplayClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
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
      <div className="absolute bottom-14 left-8 flex size-20 items-center justify-center transition-transform" ref={dial}>
        <svg className="absolute -rotate-90" viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r={dialRadius} className="fill-none stroke-border stroke-[3]" />
          <circle ref={arc} cx="40" cy="40" r={dialRadius} className="fill-none stroke-primary stroke-[3] [stroke-linecap:round]" style={{ strokeDasharray: dialCircumference, strokeDashoffset: dialCircumference }} />
        </svg>
        <span ref={dot} className="absolute size-2 rounded-full bg-primary shadow-lg" />
        <span ref={label} className="absolute left-24 top-8 whitespace-nowrap text-sm font-medium tracking-[0.18em] text-foreground">SPIN</span>
      </div>
      <div className="absolute bottom-10 left-32 whitespace-nowrap text-[10px] font-medium tracking-[0.18em] text-muted-foreground" ref={aim}>AIM CENTER · MID · SPIN 0 · POWER 0</div>
      <div className="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-4xl font-medium tracking-[0.18em]" ref={callout} />
    </>
  );
}

const emoteLifeMs = 1400;
const emotePaddleRange = TABLE.halfWidth + 0.5;

export function EmoteBubbles() {
  const player = useRef(null);
  const opponent = useRef(null);
  const emotes = useGameStore((state) => state.emotes);
  const emotesRef = useRef(emotes);

  useEffect(() => {
    emotesRef.current = emotes;
  }, [emotes]);

  useEffect(() => {
    let raf = 0;
    const place = (node, emote, racket, top) => {
      if (!node || !emote) {
        if (node) node.style.opacity = '0';
        return;
      }
      const age = performance.now() - emote.at;
      if (age >= emoteLifeMs) {
        node.style.opacity = '0';
        return;
      }
      const t = Math.max(0, Math.min(1, age / emoteLifeMs));
      const x = Math.max(-1, Math.min(1, (racket?.x || 0) / emotePaddleRange));
      node.textContent = emote.emoji;
      node.style.left = `${50 + x * 23}%`;
      node.style.top = top;
      node.style.opacity = String(Math.sin((1 - t) * Math.PI * 0.5));
      node.style.transform = `translate(-50%, -50%) translateY(${-28 * t}px) scale(${0.82 + Math.sin(Math.min(1, t * 1.8) * Math.PI) * 0.22})`;
    };
    const tick = () => {
      const latest = emotesRef.current || {};
      place(player.current, latest.player, networkGame.player, '67%');
      place(opponent.current, latest.ai, networkGame.ai, '34%');
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      <div ref={player} className="absolute grid size-14 place-items-center rounded-full border bg-popover/90 text-3xl shadow-xl backdrop-blur-md" />
      <div ref={opponent} className="absolute grid size-14 place-items-center rounded-full border bg-popover/90 text-3xl shadow-xl backdrop-blur-md" />
    </div>
  );
}

export function DifficultyButtons() {
  const difficulty = useGameStore((state) => state.difficulty);
  const mode = useGameStore((state) => state.mode);
  const networkStatus = useGameStore((state) => state.networkStatus);
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  return (
    <div className={row}>
      {BOTS.map((bot) => (
        <Button variant="outline" size="sm" key={bot.id} className={cn('uppercase tracking-[0.16em]', bot.id === difficulty && activeButton)} onClick={() => setDifficulty(bot.id)} title={bot.tag}>
          {bot.name}
        </Button>
      ))}
    </div>
  );
}



export function PlayerSpeedSetting() {
  const playerSpeed = useGameStore((state) => state.playerSpeed);
  const setPlayerSpeed = useGameStore((state) => state.setPlayerSpeed);
  return (
    <label className="grid grid-cols-[1fr_72px_auto] items-center gap-2" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <span className={labelText}>PLAYER SPEED</span>
      <Input
        type="number"
        min={Math.round(PLAYER_SPEED.min * 100)}
        max={Math.round(PLAYER_SPEED.max * 100)}
        step="5"
        value={Math.round(playerSpeed * 100)}
        onChange={(event) => setPlayerSpeed(Number(event.target.value) / 100)}
        aria-label="player speed percent"
      />
      <em className="text-xs not-italic text-muted-foreground">%</em>
    </label>
  );
}

export function PerformanceSettings() {
  const performancePrefs = useGameStore((state) => state.performancePrefs);
  const setPerformancePref = useGameStore((state) => state.setPerformancePref);
  return (
    <div className="grid gap-3 rounded-2xl border bg-background/60 p-3" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className={labelText}>PERFORMANCE</div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <span className={labelText}>RENDER SCALE</span>
        <div className="flex gap-1">
          {Object.entries(RENDER_SCALES).map(([key, value]) => (
            <Button variant="outline" size="sm"
              key={key}
              type="button"
              className={cn('uppercase tracking-[0.12em]', performancePrefs.renderScale === key && activeButton)}
              onClick={() => setPerformancePref('renderScale', key)}
            >
              {value.label}
            </Button>
          ))}
        </div>
      </div>
      <label className="grid grid-cols-[1fr_auto] items-center gap-3">
        <span className={labelText}>EXTRA FX</span>
        <Switch
          checked={performancePrefs.extraFx}
          onCheckedChange={(checked) => setPerformancePref('extraFx', checked)}
          aria-label="extra effects"
        />
      </label>
    </div>
  );
}

function ReplayBrowser() {
  const open = useGameStore((state) => state.replayBrowserOpen);
  const authUser = useGameStore((state) => state.authUser);
  const authToken = useGameStore((state) => state.authToken);
  const replayStatus = useGameStore((state) => state.replayStatus);
  const replayError = useGameStore((state) => state.replayError);
  const closeReplayBrowser = useGameStore((state) => state.closeReplayBrowser);
  const setReplayError = useGameStore((state) => state.setReplayError);
  const [matches, setMatches] = useState([]);
  const [lookup, setLookup] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!authUser) {
      setMatches([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    fetchMyMatches(20, 0)
      .then((data) => { if (!cancelled) setMatches(data.matches || []); })
      .catch((error) => { if (!cancelled) setReplayError(error?.message || 'Could not load replays'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, authUser, setReplayError]);

  if (!open) return null;
  const play = async (matchId, viewerSide = 'p1') => {
    try {
      await replayGame.load(matchId, authToken, viewerSide);
    } catch {
      // replayGame already writes error state.
    }
  };
  const directId = lookup.trim();
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-background/50 p-6 backdrop-blur-sm" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <section className={cn(glassPanel, 'grid max-h-[86vh] w-[min(860px,92vw)] gap-4 overflow-auto')}>
        <header className="flex items-center justify-between gap-4">
          <div>
            <span className={labelText}>REPLAY ROOM</span>
            <h2 className="mt-1 text-3xl font-medium tracking-[0.12em]">LOAD REPLAY</h2>
          </div>
          <Button variant="outline" size="sm" onClick={closeReplayBrowser}>CLOSE</Button>
        </header>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="MATCH ID" aria-label="match id" />
          <Button variant="outline" size="sm" disabled={!directId || replayStatus === 'loading'} onClick={() => play(directId)}>PLAY ID</Button>
        </div>
        {busy && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">LOADING MATCHES...</div>}
        {replayError && replayStatus === 'error' && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-destructive">{replayError}</div>}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {!busy && matches.length === 0 && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">{authUser ? 'NO SAVED REPLAYS YET' : 'PASTE A MATCH ID TO WATCH'}</div>}
          {matches.map((item) => {
            const match = item.match;
            const viewerWon = match.winner === item.viewerSide;
            return (
              <article className={cn('relative grid gap-3 overflow-hidden rounded-2xl border bg-background/70 p-4 shadow-sm', viewerWon ? 'border-primary/30' : 'border-border')} key={match.id}>
                <div className={cn('absolute inset-y-0 left-0 w-1', viewerWon ? 'bg-primary' : 'bg-muted-foreground')} />
                <div className="flex items-center justify-between gap-2 text-[10px] font-medium tracking-[0.14em] text-muted-foreground">
                  <span>{formatReplayDate(match.endedAt || match.startedAt)}</span>
                  <Badge variant={match.ranked ? 'default' : 'secondary'}>{match.ranked ? 'RANKED' : match.mode.toUpperCase()}</Badge>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <span className="truncate text-sm font-medium tracking-[0.08em]">{match.p1Name}</span>
                  <strong className="text-2xl font-medium">{match.p1Score}—{match.p2Score}</strong>
                  <span className="truncate text-right text-sm font-medium tracking-[0.08em]">{match.p2Name}</span>
                </div>
                <div className="flex justify-between gap-2 text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
                  <span>{item.stats.winners} WINNERS</span>
                  <span>{item.stats.smashes} SMASHES</span>
                  <span>{item.stats.longestRally} LONGEST</span>
                </div>
                <Button variant="outline" size="sm" disabled={!item.replayReady || replayStatus === 'loading'} onClick={() => play(match.id, item.viewerSide)}>
                  {item.replayReady ? 'PLAY' : 'NOT READY'}
                </Button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function statNumber(value, decimals = 0) {
  const number = Number(value) || 0;
  return decimals ? number.toFixed(decimals) : String(Math.round(number));
}

function ProfileModal({ open, onClose, leaderboard }) {
  const authUser = useGameStore((state) => state.authUser);
  const authToken = useGameStore((state) => state.authToken);
  const rankedProfile = useGameStore((state) => state.rankedProfile);
  const replayStatus = useGameStore((state) => state.replayStatus);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !authUser) return;
    let cancelled = false;
    setBusy(true);
    setError('');
    fetchMyStats()
      .then((data) => { if (!cancelled) setStats(data.stats || null); })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Could not load profile'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, authUser]);

  if (!open) return null;
  const recent = stats?.recentMatches || [];
  const play = async (matchId, viewerSide = 'p1') => {
    try {
      await replayGame.load(matchId, authToken, viewerSide);
    } catch {
      // replayGame writes error state.
    }
  };
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-background/50 p-6 backdrop-blur-sm" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <section className={cn(glassPanel, 'grid max-h-[88vh] w-[min(1040px,94vw)] gap-4 overflow-auto')}>
        <header className="flex items-center justify-between gap-4">
          <div>
            <span className={labelText}>PLAYER PROFILE</span>
            <h2 className="mt-1 text-3xl font-medium tracking-[0.12em]">{authUser?.name || 'PLAYER'}</h2>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>CLOSE</Button>
        </header>
        <div className="grid grid-cols-3 gap-3">
          <div className={statBox}>
            <span className={labelText}>RATING</span>
            <b>{rankedProfile?.rating ?? '—'}</b>
          </div>
          <div className={statBox}>
            <span className={labelText}>RECORD</span>
            <b>{rankedProfile ? `${rankedProfile.wins}-${rankedProfile.losses}` : '—'}</b>
          </div>
          <div className={statBox}>
            <span className={labelText}>RANKED</span>
            <b>{rankedProfile?.gamesPlayed ?? 0}</b>
          </div>
        </div>
        {busy && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">LOADING PROFILE...</div>}
        {error && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-destructive">{error}</div>}
        {stats && (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
              <div className={statBox}><span className={labelText}>MATCHES</span><b>{stats.matches}</b></div>
              <div className={statBox}><span className={labelText}>WIN RATE</span><b>{pct(stats.winRate)}</b></div>
              <div className={statBox}><span className={labelText}>POINTS</span><b>{stats.pointsWon}-{stats.pointsLost}</b></div>
              <div className={statBox}><span className={labelText}>POINT RATE</span><b>{pct(stats.pointWinRate)}</b></div>
              <div className={statBox}><span className={labelText}>SHOTS</span><b>{stats.shots}</b></div>
              <div className={statBox}><span className={labelText}>SMASHES</span><b>{stats.smashes}</b></div>
              <div className={statBox}><span className={labelText}>FASTEST</span><b>{statNumber(stats.fastestShotSpeed, 1)}</b></div>
              <div className={statBox}><span className={labelText}>AVG SPEED</span><b>{statNumber(stats.avgShotSpeed, 1)}</b></div>
              <div className={statBox}><span className={labelText}>ACES</span><b>{stats.aces}</b></div>
              <div className={statBox}><span className={labelText}>WINNERS</span><b>{stats.winners}</b></div>
              <div className={statBox}><span className={labelText}>FAULTS</span><b>{stats.faultsCommitted}</b></div>
              <div className={statBox}><span className={labelText}>DRAWN</span><b>{stats.faultsDrawn}</b></div>
              <div className={statBox}><span className={labelText}>LONGEST</span><b>{stats.longestRally}</b></div>
              <div className={statBox}><span className={labelText}>AVG RALLY</span><b>{statNumber(stats.avgRally, 1)}</b></div>
            </div>
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(240px,.75fr)] gap-4">
              <section className="grid gap-3 rounded-2xl border bg-background/60 p-4">
                <h3 className={labelText}>RECENT REPLAYS</h3>
                <div className="grid gap-2">
                  {recent.length === 0 && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">NO MATCHES YET</div>}
                  {recent.map((item) => {
                    const match = item.match;
                    const won = match.winner === item.viewerSide;
                    return (
                      <div className={cn('grid grid-cols-[92px_1fr_auto_auto] items-center gap-2 rounded-2xl border bg-background/70 p-3 text-xs shadow-sm', won ? 'border-primary/30' : 'border-border')} key={match.id}>
                        <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground">{formatReplayDate(match.endedAt || match.startedAt)}</span>
                        <b className="truncate tracking-[0.08em]">{match.p1Name} {match.p1Score}—{match.p2Score} {match.p2Name}</b>
                        <em className="text-[10px] not-italic tracking-[0.12em] text-muted-foreground">{item.stats.winners} W · {item.stats.smashes} S · {item.stats.longestRally} R</em>
                        <Button variant="outline" size="sm" disabled={!item.replayReady || replayStatus === 'loading'} onClick={() => play(match.id, item.viewerSide)}>
                          {item.replayReady ? 'PLAY' : 'NO REPLAY'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="grid gap-3 rounded-2xl border bg-background/60 p-4">
                <h3 className={labelText}>FULL LEADERBOARD</h3>
                <div className="grid max-h-[360px] gap-1 overflow-auto pr-1">
                  {(leaderboard || []).map((entry, index) => (
                    <div className="grid grid-cols-[40px_1fr_56px] items-center gap-2 text-xs" key={`${entry.rank}-${entry.name}-${index}`}>
                      <span className="text-muted-foreground">#{entry.rank}</span>
                      <b className="truncate">{entry.name}</b>
                      <em className="not-italic text-muted-foreground">{entry.rating}</em>
                    </div>
                  ))}
                  {(!leaderboard || leaderboard.length === 0) && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">NO RANKED MATCHES YET</div>}
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ReplayControls() {
  const mode = useGameStore((state) => state.mode);
  const match = useGameStore((state) => state.replayMatch);
  const stats = useGameStore((state) => state.replayStats);
  const timeMs = useGameStore((state) => state.replayTimeMs);
  const durationMs = useGameStore((state) => state.replayDurationMs);
  const playing = useGameStore((state) => state.replayPlaying);
  const speed = useGameStore((state) => state.replaySpeed);
  const setReplayPlaying = useGameStore((state) => state.setReplayPlaying);
  const setReplaySpeed = useGameStore((state) => state.setReplaySpeed);
  if (mode !== 'replay' || !match) return null;
  const points = replayGame.playerRef?.points || [];
  const shots = replayGame.playerRef?.shots || [];
  return (
    <div className={cn(glassPanel, 'fixed bottom-5 left-1/2 z-10 grid w-[min(980px,94vw)] -translate-x-1/2 gap-3 p-4')} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
        <span className={labelText}>{match.ranked ? 'RANKED REPLAY' : `${match.mode.toUpperCase()} REPLAY`}</span>
        <b className="text-sm tracking-[0.12em]">{match.p1Name} {match.p1Score}—{match.p2Score} {match.p2Name}</b>
        {stats && <em className="text-[10px] not-italic tracking-[0.12em] text-muted-foreground">{stats.totalPoints} PTS · {stats.totalShots} SHOTS · {stats.longestRally} RALLY · DRAG CAMERA</em>}
      </div>
      <div className="grid grid-cols-[auto_auto_1fr_auto_repeat(4,auto)] items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setReplayPlaying(!playing)}>{playing ? 'PAUSE' : 'PLAY'}</Button>
        <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground">{formatReplayClock(timeMs)}</span>
        <Slider
          min={0}
          max={Math.max(1, durationMs)}
          value={Math.min(timeMs, Math.max(1, durationMs))}
          onValueChange={(value) => {
            setReplayPlaying(false);
            replayGame.seek(Number(value));
          }}
          aria-label="replay timeline"
        />
        <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground">{formatReplayClock(durationMs)}</span>
        {[0.5, 1, 2].map((value) => (
          <Button variant="outline" size="sm" key={value} className={speed === value ? activeButton : ''} onClick={() => setReplaySpeed(value)}>{value}x</Button>
        ))}
        <Button variant="outline" size="sm" onClick={() => replayGame.exit()}>EXIT</Button>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {points.slice(0, 8).map((point) => (
          <Button variant="outline" size="sm" key={point.id} onClick={() => { setReplayPlaying(false); replayGame.jumpToPoint(point.seq); }}>
            P{point.seq} · {point.p1Score}-{point.p2Score}
          </Button>
        ))}
        {shots.slice(0, 8).map((shot) => (
          <Button variant="outline" size="sm" key={shot.id} onClick={() => { setReplayPlaying(false); replayGame.jumpToShot(shot.id); }}>
            S{shot.seq}{shot.smash ? ' · SMASH' : ''}
          </Button>
        ))}
      </div>
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
  const difficulty = useGameStore((state) => state.difficulty);
  const setPlayerName = useGameStore((state) => state.setPlayerName);
  const setNetworkStatus = useGameStore((state) => state.setNetworkStatus);
  const openReplayBrowser = useGameStore((state) => state.openReplayBrowser);
  const start = useGameStore((state) => state.start);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
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
  const showTestAi = import.meta.env.DEV || DEBUG_MODE;
  if (started || !revealed) return null;
  return (
    <>
    <div className={cn(glassPanel, 'fixed bottom-7 left-1/2 z-[6] grid w-[min(760px,92vw)] -translate-x-1/2 gap-3')} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className={cn(labelText, 'text-center')}>MODE</div>
      <div className={row}>
        <Input
          className="w-48 text-center font-medium uppercase tracking-[0.18em]"
          value={playerName}
          onChange={(event) => setPlayerName(event.target.value)}
          placeholder="NAME"
          maxLength={12}
          aria-label="player name"
        />
      </div>
      <div className="grid gap-3 border-y py-3">
        {authUser ? (
          <>
            <div className="flex items-center justify-center gap-3 text-xs">
              <b>{authUser.name}</b>
              <span className="text-muted-foreground">{rankedProfile ? `${rankedProfile.rating} ELO · ${rankedProfile.wins}-${rankedProfile.losses}` : 'RANK LOADING'}</span>
            </div>
            <div className={row}>
              <Button variant="outline" size="sm" onClick={() => setProfileOpen(true)} disabled={busy}>PROFILE</Button>
              <Button variant="outline" size="sm" onClick={() => run(() => networkGame.signOut())} disabled={busy}>LOG OUT</Button>
            </div>
          </>
        ) : (
          <>
            <div className={row}>
              <Input className="w-48 text-center" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" aria-label="email" />
              <Input className="w-44 text-center" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="PASSWORD" type="password" aria-label="password" />
            </div>
            <div className={row}>
              <Button variant="outline" size="sm" onClick={() => run(() => networkGame.signIn(email, password))} disabled={busy || !email || !password}>SIGN IN</Button>
              <Button variant="outline" size="sm" onClick={() => run(() => networkGame.register(email, password))} disabled={busy || !email || !password}>REGISTER</Button>
            </div>
          </>
        )}
      </div>
      <div className={row}>
        <Button variant="outline" size="sm" onClick={start} disabled={busy}>OFFLINE</Button>
        <Button variant="outline" size="sm" onClick={() => run(() => networkGame.quickMatch())} disabled={busy}>QUICK MATCH</Button>
        <Button variant="outline" size="sm" onClick={() => run(() => networkGame.rankedMatch())} disabled={busy || !authUser}>RANKED</Button>
        <Button variant="outline" size="sm" onClick={openReplayBrowser} disabled={busy}>REPLAYS</Button>
        {showTestAi && <Button variant="outline" size="sm" onClick={() => run(() => networkGame.testAiMatch(difficulty))} disabled={busy}>TEST AI ONLINE</Button>}
      </div>
      <div className={row}>
        <Button variant="outline" size="sm" onClick={() => run(() => networkGame.createPrivate())} disabled={busy}>CREATE ROOM</Button>
        <Input className="w-28 text-center uppercase tracking-[0.18em]" value={code} onChange={(event) => updateCode(event.target.value)} placeholder="CODE" maxLength={5} />
      </div>
      {networkStatus === 'connecting' && <div className="text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">CONNECTING...</div>}
      {networkStatus === 'waiting' && <div className="text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">SEARCHING{rankedQueueCount ? ` · ${rankedQueueCount}/2` : ''}</div>}
      {networkError && <div className="text-center text-xs font-medium tracking-[0.2em] text-destructive">{networkError}</div>}
      <div className="grid gap-2 rounded-2xl border bg-background/60 p-3">
        <div className={cn(labelText, 'text-center')}>TOP 3</div>
        {(leaderboard || []).slice(0, 3).map((entry, index) => (
          <div className="grid grid-cols-[40px_1fr_56px] items-center gap-2 text-xs" key={`${entry.rank}-${entry.name}-${index}`}>
            <span className="text-muted-foreground">#{entry.rank}</span>
            <b className="truncate">{entry.name}</b>
            <em className="not-italic text-muted-foreground">{entry.rating}</em>
          </div>
        ))}
        {(!leaderboard || leaderboard.length === 0) && <div className="text-center text-xs font-medium tracking-[0.16em] text-muted-foreground">NO RANKED MATCHES YET</div>}
      </div>
    </div>
    <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} leaderboard={leaderboard} />
    <ReplayBrowser />
    </>
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
  const onlineRematchRequested = useGameStore((state) => state.onlineRematchRequested);
  const currentMatchId = useGameStore((state) => state.currentMatchId);
  const authToken = useGameStore((state) => state.authToken);
  const onlineSide = useGameStore((state) => state.onlineSide);
  const replayMatch = useGameStore((state) => state.replayMatch);
  const replayViewerSide = useGameStore((state) => state.replayViewerSide);

  const bot = BOTS.find((item) => item.id === difficulty) ?? BOTS[1];
  const botName = bot.name;
  const replayLocalIsP1 = replayViewerSide !== 'p2';
  const youName = mode === 'replay' && replayMatch ? (replayLocalIsP1 ? replayMatch.p1Name : replayMatch.p2Name) : playerName || 'PLAYER';
  const opponentName = mode === 'replay' && replayMatch ? (replayLocalIsP1 ? replayMatch.p2Name : replayMatch.p1Name) : mode === 'online' ? (onlineOpponentName || 'OPPONENT') : botName;
  const playerWon = winner === 'player';
  const delta = Math.abs(scoreP - scoreAI);
  const flavor = mode === 'online'
    ? playerWon
      ? `${opponentName} WANTS ANOTHER SHOT`
      : `GET REVENGE AGAINST ${opponentName}`
    : playerWon
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
    <div className="pointer-events-none fixed inset-0 z-[5]">
      <ReplayControls />
      {started && menuOpen && phase !== 'over' && <div className="fixed inset-0 bg-background/30 backdrop-blur-sm" aria-hidden />}

      {started && (
        <>
          <div className="absolute left-1/2 top-7 hidden -translate-x-1/2 flex-col items-center gap-2">
            <div className={labelText}>MATCH TO {MATCH_TO}</div>
            <div className="flex items-start gap-7">
              <div className="flex flex-col items-center gap-1">
                <span className={cn(labelText, server === 'player' && 'text-primary')}>{youName}</span>
                <span className="font-mono text-6xl font-light tabular-nums">{padScore(scoreP)}</span>
              </div>
              <span className="translate-y-5 text-4xl font-light text-border">|</span>
              <div className="flex flex-col items-center gap-1">
                <span className={cn(labelText, server === 'ai' && 'text-primary')}>{opponentName}</span>
                <span className="font-mono text-6xl font-light tabular-nums">{padScore(scoreAI)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <i className={cn('size-1.5 rounded-full bg-border', server === 'player' && 'bg-primary shadow-lg')} />
              <i className={cn('size-1.5 rounded-full bg-border', server === 'ai' && 'bg-primary shadow-lg')} />
            </div>
          </div>
          {serveMessage && <div className="absolute left-1/2 top-[63%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium tracking-[0.34em] text-foreground">{serveMessage}</div>}
          {flashText && phase !== 'over' && (
            <div key={flashId} className="pointer-events-none absolute left-1/2 top-1/3 whitespace-nowrap text-5xl font-medium tracking-[0.14em] [animation:hudPop_1s_cubic-bezier(.2,1.3,.3,1)_forwards]" style={{ color: flashColor, textShadow: `0 0 30px ${flashColor}55` }}>
              {flashText}
            </div>
          )}
          <ChargeDial />
          {mode === 'online' && <EmoteBubbles />}
          {firstServe && <div className="absolute bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tracking-[0.28em] text-muted-foreground">MOVE&nbsp;TO&nbsp;AIM&nbsp;·&nbsp;HOLD&nbsp;CHARGE&nbsp;·&nbsp;FLICK&nbsp;SPIN</div>}
          {!isCoarsePointer && phase !== 'over' && !menuOpen && (
            <div className="pointer-events-none absolute right-7 top-24 flex items-center gap-2 rounded-full border bg-popover/80 px-3 py-1 text-[10px] font-medium tracking-[0.2em] text-muted-foreground shadow-sm backdrop-blur" aria-hidden>
              <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-foreground">ESC</kbd>
              <span>PAUSE</span>
            </div>
          )}
        </>
      )}

      {started && menuOpen && phase !== 'over' && (
        <div className={cn(glassPanel, 'absolute left-1/2 top-1/2 grid w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 gap-4')}>
          <h3 className={cn(labelText, 'text-center')}>PAUSED</h3>
          <ul className="grid gap-3 text-xs">
            <li className="flex justify-between gap-4"><b>Move</b><span className="text-muted-foreground">{isCoarsePointer ? 'Drag' : 'A / D'}</span></li>
            <li className="flex justify-between gap-4"><b>Aim landing</b><span className="text-muted-foreground">{isCoarsePointer ? 'Move across table' : 'Mouse'}</span></li>
            <li className="flex justify-between gap-4"><b>Charge power</b><span className="text-muted-foreground">{isCoarsePointer ? 'Hold' : 'Hold mouse · Space'}</span></li>
            <li className="flex justify-between gap-4"><b>Spin</b><span className="text-muted-foreground">{isCoarsePointer ? 'Flick at contact' : 'W / S'}</span></li>
            <li className="flex justify-between gap-4"><b>Smash</b><span className="text-muted-foreground">Charge high ball</span></li>
            <li className="flex justify-between gap-4"><b>Serve</b><span className="text-muted-foreground">Release</span></li>
            {mode === 'online' && <li className="flex justify-between gap-4"><b>Emote</b><span className="text-muted-foreground">1 / 2 / 3 / 4</span></li>}
            {!isCoarsePointer && <li className="flex justify-between gap-4"><b>Pause · back</b><span className="text-muted-foreground">Esc</span></li>}
          </ul>
          <Separator />
          <PlayerSpeedSetting />
          <PerformanceSettings />
          <Separator />
          {mode !== 'online' && <Button variant="outline" size="sm" onClick={newGame}>RESTART&nbsp;GAME</Button>}
          <Button variant="outline" size="sm" onClick={() => { if (mode === 'online') networkGame.disconnect(); else goHome(); }}>EXIT&nbsp;TO&nbsp;LOBBY</Button>
          <Button size="sm" onClick={toggleMenu}>RESUME</Button>
        </div>
      )}

      {phase === 'over' && mode !== 'replay' && (
        <div className={cn('pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm', !playerWon && 'bg-muted/80')}>
          <div className={labelText}>{playerWon ? 'GAME · SET · MATCH' : 'MATCH OVER'}</div>
          <div className="mt-4 text-7xl font-medium tracking-[0.1em]">{playerWon ? 'YOU WIN' : `${opponentName} WINS`}</div>
          <div className="my-5 flex items-start gap-6">
            <div className="flex flex-col items-center gap-1"><span className={labelText}>{youName}</span><span className="font-mono text-5xl">{scoreP}</span></div>
            <span className="mt-6 text-2xl text-muted-foreground">—</span>
            <div className="flex flex-col items-center gap-1"><span className={labelText}>{opponentName}</span><span className="font-mono text-5xl">{scoreAI}</span></div>
          </div>
          <div className="mb-8 text-xs italic tracking-[0.18em] text-muted-foreground">{flavor}</div>
          <div className="flex flex-col items-center">
            <div className={cn(glassPanel, 'grid w-[min(500px,90vw)] justify-items-center gap-4')}>
              {mode === 'online' ? (
                <>
                  <div className={labelText}>SAME PLAYER</div>
                  <div className="text-center text-sm font-medium tracking-[0.2em]">RUN IT BACK AGAINST {opponentName}</div>
                </>
              ) : (
                <>
                  <div className={labelText}>NEXT OPPONENT</div>
                  <DifficultyButtons />
                </>
              )}
            </div>
            <div className="mt-5 flex items-center gap-3">
              {mode === 'online' ? (
                <Button size="lg" onClick={() => networkGame.requestRematch()}>
                  {onlineRematchRequested ? 'WAITING · REVENGE' : `REVENGE · ${opponentName}`}
                </Button>
              ) : (
                <Button size="lg" onClick={newGame}>REMATCH&nbsp;·&nbsp;{botName}</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => { if (mode === 'online') networkGame.disconnect(); else goHome(); }}>↩&nbsp;&nbsp;HOME</Button>
              {currentMatchId && (
                <Button variant="ghost" size="sm" onClick={() => replayGame.load(currentMatchId, authToken, onlineSide || 'p1').catch(() => {})}>
                  ▶&nbsp;&nbsp;WATCH&nbsp;REPLAY
                </Button>
              )}
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
        const charge = inputHud.charging ? Math.max(0, Math.min(1, inputHud.charge)) : 0;
        node.style.setProperty('--cursor-accent-opacity', String(0.45 + charge * 0.25));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[10000] size-0 opacity-0 transition-opacity duration-150"
      aria-hidden
      style={{ '--cursor-accent-opacity': 0.45 }}
    >
      <span className="absolute left-0 top-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/55 bg-background/20 shadow-[0_0_0_1px_rgba(255,255,255,0.42)]" />
      <span className="absolute left-0 top-0 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary [opacity:var(--cursor-accent-opacity)]" />
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
    <div className={cn('fixed inset-0 z-[9] flex items-center justify-center bg-background transition-opacity duration-1000', leaving && 'pointer-events-none opacity-0')}>
      <div className="flex pl-[0.34em] text-[clamp(64px,10vw,150px)] font-semibold tracking-[0.34em] text-foreground" aria-label="BACKSPIN">
        {'BACKSPIN'.split('').map((letter, index) => (
          <span key={index} className="opacity-0 [animation:introGlyph_1s_cubic-bezier(.16,.7,.2,1)_forwards]" style={{ animationDelay: `${0.25 + index * 0.09}s` }}>{letter}</span>
        ))}
      </div>
    </div>
  );
}
