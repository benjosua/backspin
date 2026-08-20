// Recovered DOM HUD stack from production bundle names `Jj`, `dM`, `hM` and helpers.

import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import { BOTS, COLORS, PLAYER_SPEED, RACKET_COLOR_PALETTES } from '../constants.js';
import { TABLE } from '../../serve/src/shared/game-core.js';
import { NET } from '../../serve/src/shared/game-core.js';
import { inputHud } from '../view-state.js';
import { acceptFriendRequest, consumeInviteFromUrl, declineFriendRequest, disablePushNotifications, enablePushNotifications, fetchFriends, fetchMyStats, networkGame, refreshLivePlayerPresence, searchUsers, sendFriendRequest } from '../network.js';
import { replayGame } from '../replay.js';
import { OPEN_FRIENDS_EVENT, SOCIAL_NOTIFICATION_EVENT } from '../social-notifications.js';
import { RENDER_SCALES, useGameStore } from '../store.js';
import { subscribeHudFrame } from '../hud-ticker.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const MATCH_TO = 11;
const padScore = (value) => String(value).padStart(2, '0');
const dialRadius = 30;
const dialCircumference = Math.PI * 2 * dialRadius;
const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const glassPanel = 'pointer-events-auto rounded-2xl border border-foreground/10 bg-background/82 p-4 text-foreground tracking-[0.04em] shadow-lg shadow-background/20 backdrop-blur-sm';
const labelText = 'text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground';
const row = 'flex flex-wrap items-center justify-center gap-2';
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

const rankTiers = [
  { name: 'ONYX', min: 2000 },
  { name: 'MASTER', min: 1800 },
  { name: 'DIAMOND', min: 1650 },
  { name: 'PLATINUM', min: 1500 },
  { name: 'GOLD', min: 1350 },
  { name: 'SILVER', min: 1200 },
  { name: 'BRONZE', min: 1000 },
  { name: 'ROOKIE', min: 0 },
];
const PLACEMENT_GAMES = 3;
const CALIBRATION_GAMES = 30;

function rankTier(rating = 1200) {
  return rankTiers.find((tier) => rating >= tier.min) || rankTiers[rankTiers.length - 1];
}

function ratingPhase(profile) {
  const games = profile?.gamesPlayed ?? 0;
  const rating = profile?.rating ?? 1200;
  if (games < PLACEMENT_GAMES) return { label: 'PLACEMENT', detail: `${PLACEMENT_GAMES - games} fast-calibration games left`, progress: games / PLACEMENT_GAMES, k: 48 };
  if (games < CALIBRATION_GAMES) return { label: 'CALIBRATING', detail: `${CALIBRATION_GAMES - games} early-ladder games left`, progress: (games - PLACEMENT_GAMES) / (CALIBRATION_GAMES - PLACEMENT_GAMES), k: 40 };
  if (rating >= 1800) return { label: 'ELITE', detail: 'tight high-rank changes', progress: 1, k: 24 };
  if (rating >= 1500) return { label: 'ESTABLISHED', detail: 'stable rating changes', progress: 1, k: 28 };
  return { label: 'ESTABLISHED', detail: 'standard rating changes', progress: 1, k: 32 };
}

export function ChargeDial() {
  const arc = useRef(null);
  const dot = useRef(null);
  const label = useRef(null);
  const dial = useRef(null);
  const callout = useRef(null);
  const aim = useRef(null);

  useEffect(() => {
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
    };
    return subscribeHudFrame(tick);
  }, []);

  return (
    <>
      <div className="absolute bottom-14 left-8 flex size-20 items-center justify-center transition-transform" ref={dial}>
        <svg className="absolute -rotate-90" viewBox="0 0 80 80" width="80" height="80">
          <circle cx="40" cy="40" r={dialRadius} className="fill-none stroke-border stroke-[3]" />
          <circle ref={arc} cx="40" cy="40" r={dialRadius} className="fill-none stroke-primary stroke-[3] [stroke-linecap:round]" style={{ strokeDasharray: dialCircumference, strokeDashoffset: dialCircumference }} />
        </svg>
        <span ref={dot} className="absolute size-2 rounded-full bg-primary shadow-lg" />
        <span ref={label} className="absolute left-24 top-8 whitespace-nowrap text-sm font-medium tracking-[0.18em] text-muted-foreground">SPIN</span>
      </div>
      <div className="absolute bottom-10 left-32 whitespace-nowrap text-[10px] font-medium tracking-[0.18em] text-muted-foreground" ref={aim}>AIM CENTER · MID · SPIN 0 · POWER 0</div>
      <div className="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-4xl font-medium tracking-[0.18em]" ref={callout} />
    </>
  );
}

const emoteLifeMs = 1400;
const emotePaddleRange = TABLE.halfWidth + NET.paddleInset;

export function EmoteBubbles() {
  const player = useRef(null);
  const opponent = useRef(null);
  const emotes = useGameStore((state) => state.emotes);
  const emotesRef = useRef(emotes);

  useEffect(() => {
    emotesRef.current = emotes;
  }, [emotes]);

  useEffect(() => {
    const place = (node, emote, racket) => {
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
      node.style.opacity = String(Math.sin((1 - t) * Math.PI * 0.5));
      node.style.transform = `translate(calc(-50% + ${x * 23}vw), -50%) translateY(${-28 * t}px) scale(${0.82 + Math.sin(Math.min(1, t * 1.8) * Math.PI) * 0.22})`;
    };
    const tick = () => {
      const latest = emotesRef.current || {};
      place(player.current, latest.player, networkGame.player);
      place(opponent.current, latest.ai, networkGame.ai);
    };
    return subscribeHudFrame(tick);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-10" aria-hidden>
      <div ref={player} className="absolute left-1/2 top-[67%] grid size-14 place-items-center rounded-full border bg-popover/90 text-3xl shadow-xl backdrop-blur-md" />
      <div ref={opponent} className="absolute left-1/2 top-[34%] grid size-14 place-items-center rounded-full border bg-popover/90 text-3xl shadow-xl backdrop-blur-md" />
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

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function statNumber(value, decimals = 0) {
  const number = Number(value) || 0;
  return decimals ? number.toFixed(decimals) : String(Math.round(number));
}

function compactStat(value, decimals = 0) {
  if (typeof value === 'string') return value;
  const number = Number(value) || 0;
  return decimals ? number.toFixed(decimals) : String(Math.round(number));
}

function MiniStatGraph({ title, value, detail, items }) {
  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
  return (
    <section className="grid gap-3 rounded-2xl border bg-card/65 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className={labelText}>{title}</h4>
          {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
        </div>
        <b className="text-right text-2xl font-medium tabular-nums tracking-[-0.04em]">{value}</b>
      </div>
      <div className="grid gap-2">
        {items.map((item, index) => {
          const width = Math.max(3, Math.min(100, ((Number(item.value) || 0) / max) * 100));
          const color = item.color || `var(--chart-${(index % 5) + 1})`;
          return (
            <div className="grid grid-cols-[72px_minmax(0,1fr)_44px] items-center gap-2 text-xs" key={item.label}>
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-[var(--bar-color)]" style={{ width: `${width}%`, '--bar-color': color }} />
              </span>
              <span className="text-right font-medium tabular-nums">{item.display ?? compactStat(item.value, item.decimals)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}


function FriendsPanel({ open }) {
  const authUser = useGameStore((state) => state.authUser);
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = async () => {
    if (!authUser) return;
    const data = await fetchFriends();
    setFriends(data.friends || []);
    setIncoming(data.incomingRequests || []);
    setOutgoing(data.outgoingRequests || []);
  };
  const run = async (fn) => {
    setBusy(true);
    setStatus('');
    try {
      const message = await fn();
      if (message) setStatus(message);
      await load();
    } catch (error) {
      setStatus(error?.message || 'Friends action failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !authUser) return;
    load().catch((error) => setStatus(error?.message || 'Could not load friends'));
  }, [open, authUser]);
  useEffect(() => {
    if (typeof window === 'undefined' || !open || !authUser) return undefined;
    const refresh = (event) => {
      const kind = event.detail?.kind;
      if (kind !== 'friend_request' && kind !== 'game_invite') return;
      load().catch((error) => setStatus(error?.message || 'Could not load friends'));
    };
    window.addEventListener(SOCIAL_NOTIFICATION_EVENT, refresh);
    return () => window.removeEventListener(SOCIAL_NOTIFICATION_EVENT, refresh);
  }, [open, authUser]);

  const doSearch = () => run(async () => {
    const data = await searchUsers(query);
    setResults(data.users || []);
    return data.users?.length ? '' : 'NO PLAYERS FOUND';
  });
  const requestFriend = (user) => run(async () => {
    await sendFriendRequest(user.id);
    setResults((items) => items.filter((item) => item.id !== user.id));
    return `REQUEST SENT TO ${user.name}`;
  });
  const accept = (request) => run(async () => {
    await acceptFriendRequest(request.id);
    return `ADDED ${request.requester.name}`;
  });
  const decline = (request) => run(async () => {
    await declineFriendRequest(request.id);
    return `DECLINED ${request.requester.name}`;
  });
  const enablePush = () => run(async () => {
    await enablePushNotifications();
    return 'NOTIFICATIONS ENABLED';
  });
  const disablePush = () => run(async () => {
    const disabled = await disablePushNotifications();
    return disabled ? 'NOTIFICATIONS DISABLED' : 'NOTIFICATIONS ALREADY OFF';
  });
  const inviteStatus = (friend, notification) => {
    const live = Number(notification?.live?.sent) || 0;
    const push = Number(notification?.push?.sent) || 0;
    if (live > 0) return `INVITE SENT LIVE TO ${friend.name}`;
    if (push > 0) return `INVITE SENT PUSH TO ${friend.name}`;
    return `INVITE SENT · ${friend.name} IS OFFLINE OR NOT SUBSCRIBED`;
  };
  const invite = (friend) => run(async () => {
    const data = await networkGame.inviteFriend(friend.id);
    return inviteStatus(friend, data.notification);
  });

  if (!authUser) return <p className="text-sm text-muted-foreground">Sign in to add friends and send invites.</p>;
  return (
    <section className="grid gap-4 rounded-2xl border bg-background/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={labelText}>FRIENDS</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={enablePush} disabled={busy}>ENABLE NOTIFICATIONS</Button>
          <Button variant="outline" size="sm" onClick={disablePush} disabled={busy}>DISABLE</Button>
        </div>
      </div>
      {status && <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground">{status}</p>}

      {incoming.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">REQUESTS</h4>
          {incoming.map((request) => (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/60 p-2 text-sm" key={request.id}>
              <b>{request.requester.name}</b>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => accept(request)} disabled={busy}>ACCEPT</Button>
                <Button variant="ghost" size="sm" onClick={() => decline(request)} disabled={busy}>DECLINE</Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <h4 className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">ADD FRIEND</h4>
        <div className="flex gap-2">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && doSearch()} placeholder="NAME OR EMAIL" />
          <Button variant="outline" size="sm" onClick={doSearch} disabled={busy || query.trim().length < 2}>SEARCH</Button>
        </div>
        {results.map((user) => (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-background/60 p-2 text-sm" key={user.id}>
            <b>{user.name}</b>
            <Button variant="outline" size="sm" onClick={() => requestFriend(user)} disabled={busy}>ADD</Button>
          </div>
        ))}
        {outgoing.length > 0 && <p className="text-xs text-muted-foreground">PENDING: {outgoing.map((request) => request.recipient.name).join(', ')}</p>}
      </div>

      <div className="grid gap-2">
        <h4 className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">INVITE TO PLAY</h4>
        {friends.length === 0 && <p className="text-xs text-muted-foreground">No friends yet.</p>}
        {friends.map((friend) => (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-background/60 p-2 text-sm" key={friend.id}>
            <b>{friend.name}</b>
            <Button variant="default" size="sm" onClick={() => invite(friend)} disabled={busy}>PING</Button>
          </div>
        ))}
      </div>
    </section>
  );
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
  const tier = rankTier(rankedProfile?.rating);
  const phase = ratingPhase(rankedProfile);
  const progressPct = Math.max(0, Math.min(100, Math.round(phase.progress * 100)));
  const leaderboardRank = rankedProfile
    ? (leaderboard || []).find((entry) => entry.name === rankedProfile.name && entry.rating === rankedProfile.rating)?.rank
    : null;
  const profileName = authUser?.name || rankedProfile?.name || 'PLAYER';
  const rankedSummary = [
    ['Rating', rankedProfile?.rating ?? '—'],
    ['Rank', leaderboardRank ? `#${leaderboardRank}` : '—'],
    ['Record', rankedProfile ? `${rankedProfile.wins}-${rankedProfile.losses}` : '—'],
    ['Ranked games', rankedProfile?.gamesPlayed ?? 0],
  ];
  const statSummary = stats
    ? [
        ['Matches', stats.matches],
        ['Win rate', pct(stats.winRate)],
        ['Shots', compactStat(stats.shots)],
        ['Avg speed', statNumber(stats.avgShotSpeed, 1)],
      ]
    : [];
  const statsGraphs = stats
    ? [
        {
          title: 'OUTCOME',
          value: pct(stats.winRate),
          detail: `${stats.wins}-${stats.losses} matches · ${stats.pointsWon}-${stats.pointsLost} points`,
          items: [
            { label: 'Wins', value: stats.wins, color: 'var(--chart-4)' },
            { label: 'Losses', value: stats.losses, color: 'var(--chart-1)' },
            { label: 'Point %', value: Math.round((Number(stats.pointWinRate) || 0) * 100), display: pct(stats.pointWinRate), color: 'var(--chart-3)' },
          ],
        },
        {
          title: 'ATTACK',
          value: compactStat(stats.winners),
          detail: 'winners vs pressure shots',
          items: [
            { label: 'Winners', value: stats.winners, color: 'var(--chart-5)' },
            { label: 'Smashes', value: stats.smashes, color: 'var(--chart-3)' },
            { label: 'Aces', value: stats.aces, color: 'var(--chart-2)' },
            { label: 'Faults', value: stats.faultsCommitted, color: 'var(--chart-1)' },
          ],
        },
        {
          title: 'TEMPO',
          value: statNumber(stats.avgShotSpeed, 1),
          detail: `fastest ${statNumber(stats.fastestShotSpeed, 1)} · rally avg ${statNumber(stats.avgRally, 1)}`,
          items: [
            { label: 'Avg spd', value: stats.avgShotSpeed, decimals: 1, color: 'var(--chart-3)' },
            { label: 'Fastest', value: stats.fastestShotSpeed, decimals: 1, color: 'var(--chart-5)' },
            { label: 'Rally', value: stats.avgRally, decimals: 1, color: 'var(--chart-2)' },
            { label: 'Long', value: stats.longestRally, color: 'var(--chart-4)' },
          ],
        },
      ]
    : [];
  const play = async (matchId, viewerSide = 'p1') => {
    try {
      await replayGame.load(matchId, authToken, viewerSide);
    } catch {
      // replayGame writes error state.
    }
  };
  const chooseRacketColor = async (colorId) => {
    setBusy(true);
    setError('');
    try {
      await networkGame.updateRacketColor(colorId);
    } catch (err) {
      setError(err?.message || 'Could not update racket color');
    } finally {
      setBusy(false);
    }
  };
  const selectedRacketColor = rankedProfile?.selectedRacketColor || 'coral';
  const unlockedRacketColors = new Set(rankedProfile?.unlockedRacketColors || ['coral']);
  const selectedPalette = RACKET_COLOR_PALETTES.find((palette) => palette.id === selectedRacketColor) || RACKET_COLOR_PALETTES[0];
  const unlockedColorCount = RACKET_COLOR_PALETTES.filter((palette) => unlockedRacketColors.has(palette.id)).length;
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-background/50 p-4 backdrop-blur-sm sm:p-6" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <section className={cn(glassPanel, 'grid max-h-[88vh] w-[min(1040px,94vw)] gap-5 overflow-auto')}>
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className={labelText}>PLAYER PROFILE</span>
            <h2 className="mt-1 break-all text-3xl font-medium tracking-[0.12em]">{profileName}</h2>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>CLOSE</Button>
        </header>

        <Separator />

        <section className="grid gap-4">
          <div className="grid gap-4 rounded-2xl border bg-background/60 p-4 md:grid-cols-[1fr_220px] md:items-center">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">{tier.name}</Badge>
                <span className="text-3xl font-medium tabular-nums">{rankedProfile?.rating ?? '—'}</span>
                <span className="text-sm text-muted-foreground">ELO</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {rankedSummary.slice(1).map(([label, value]) => (
                  <span className="whitespace-nowrap" key={label}>
                    <span className="text-muted-foreground">{label}:</span> <b>{value}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>{phase.label}</b>
                <span className="text-muted-foreground">K={phase.k}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{phase.detail}. Wins vs stronger players pay more; losses vs lower players cost more.</p>
            </div>
          </div>
          <div className="grid gap-3 rounded-2xl border bg-background/45 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={labelText}>RACKET COLOR</h3>
              <span className="text-xs text-muted-foreground">{selectedPalette?.name} · {unlockedColorCount}/{RACKET_COLOR_PALETTES.length} unlocked</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {RACKET_COLOR_PALETTES.map((palette) => {
                const unlocked = unlockedRacketColors.has(palette.id);
                const selected = selectedRacketColor === palette.id;
                return (
                  <button
                    type="button"
                    key={palette.id}
                    className={cn(
                      'group relative grid size-9 place-items-center rounded-full border bg-background/70 p-1 transition hover:border-foreground/30',
                      selected && 'border-primary ring-2 ring-primary/20',
                      !unlocked && 'opacity-35 grayscale'
                    )}
                    onClick={() => unlocked && chooseRacketColor(palette.id)}
                    disabled={busy || !unlocked || selected}
                    title={unlocked ? palette.name : `Unlocks at ${palette.unlockGames} ranked games`}
                    aria-label={unlocked ? `Select ${palette.name} racket color` : `${palette.name} unlocks at ${palette.unlockGames} ranked games`}
                  >
                    <span className="size-full rounded-full shadow-inner" style={{ background: `linear-gradient(135deg, ${palette.colors.core}, ${palette.colors.edge})` }} />
                    {!unlocked && <span className="absolute -bottom-1 rounded-full bg-background px-1 text-[8px] font-medium tabular-nums text-muted-foreground">{palette.unlockGames}</span>}
                    {selected && <span className="absolute inset-2 rounded-full border-2 border-background/90" />}
                  </button>
                );
              })}
            </div>
          </div>
          {busy && <div className="py-2 text-xs font-medium tracking-[0.2em] text-muted-foreground">LOADING PROFILE...</div>}
          {error && <div className="py-2 text-xs font-medium tracking-[0.2em] text-destructive">{error}</div>}
        </section>

        <FriendsPanel open={open} />

        {stats && (
          <>
            <Separator />

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className={labelText}>STATS</h3>
                <span className="text-xs text-muted-foreground">{stats.matches} matches</span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                {statSummary.map(([label, value]) => (
                  <div className="rounded-2xl border bg-background/45 p-3" key={label}>
                    <dt className="truncate text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-2xl font-medium tabular-nums tracking-[-0.04em]">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="grid gap-3 lg:grid-cols-3">
                {statsGraphs.map((graph) => (
                  <MiniStatGraph key={graph.title} {...graph} />
                ))}
              </div>
            </section>

            <Separator />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className={labelText}>RECENT MATCHES</h3>
                  <span className="text-xs text-muted-foreground">{recent.length} shown</span>
                </div>
                <div className="grid gap-0 divide-y text-sm">
                  {recent.length === 0 && <div className="py-4 text-center text-xs font-medium tracking-[0.2em] text-muted-foreground">NO MATCHES YET</div>}
                  {recent.map((item) => {
                    const match = item.match;
                    const won = match.winner === item.viewerSide;
                    return (
                      <div className="grid gap-2 py-3 md:grid-cols-[44px_96px_minmax(0,1fr)_180px_160px] md:items-center" key={match.id}>
                        <Badge variant={won ? 'default' : 'secondary'}>{won ? 'W' : 'L'}</Badge>
                        <span className="text-xs text-muted-foreground">{formatReplayDate(match.endedAt || match.startedAt)}</span>
                        <b className="min-w-0 truncate tracking-[0.06em]">{match.p1Name} {match.p1Score}—{match.p2Score} {match.p2Name}</b>
                        <span className="text-xs text-muted-foreground">{item.stats.winners} winners · {item.stats.smashes} smashes · {item.stats.longestRally} rally</span>
                        <div className="grid justify-items-start gap-1 md:justify-items-end">
                          <div className="grid max-w-full gap-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            <span className="truncate">ROOM: {match.roomId || '—'}</span>
                            <span className="truncate">MATCH: {match.id}</span>
                          </div>
                          {item.replayReady ? (
                            <Button variant="outline" size="sm" disabled={replayStatus === 'loading'} onClick={() => play(match.id, item.viewerSide)}>
                              PLAY
                            </Button>
                          ) : (
                            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">NO REPLAY</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="grid content-start gap-3">
                <h3 className={labelText}>LEADERBOARD</h3>
                <div className="grid max-h-[380px] gap-0 divide-y overflow-auto pr-1 text-sm">
                  {(leaderboard || []).map((entry, index) => (
                    <div className="grid grid-cols-[44px_1fr_56px] items-center gap-2 py-2" key={`${entry.rank}-${entry.name}-${index}`}>
                      <span className="text-muted-foreground">#{entry.rank}</span>
                      <span className="min-w-0">
                        <b className="block truncate">{entry.name}</b>
                        <span className="text-xs text-muted-foreground">{entry.wins}-{entry.losses} · {entry.gamesPlayed} games</span>
                      </span>
                      <em className="text-right not-italic tabular-nums text-muted-foreground">{entry.rating}</em>
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
  const scoreP = useGameStore((state) => state.scoreP);
  const scoreAI = useGameStore((state) => state.scoreAI);
  const viewerSide = useGameStore((state) => state.replayViewerSide);
  const setReplayPlaying = useGameStore((state) => state.setReplayPlaying);
  const setReplaySpeed = useGameStore((state) => state.setReplaySpeed);
  if (mode !== 'replay' || !match) return null;
  const points = replayGame.playerRef?.points || [];
  const shots = replayGame.playerRef?.shots || [];
  const p1Score = viewerSide === 'p2' ? scoreAI : scoreP;
  const p2Score = viewerSide === 'p2' ? scoreP : scoreAI;
  return (
    <div className={cn(glassPanel, 'fixed bottom-5 left-1/2 z-10 grid w-[min(980px,94vw)] -translate-x-1/2 gap-3 p-4')} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
        <span className={labelText}>{match.ranked ? 'RANKED REPLAY' : `${match.mode.toUpperCase()} REPLAY`}</span>
        <b className="text-sm tracking-[0.12em]">{match.p1Name} {p1Score}—{p2Score} {match.p2Name}</b>
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
  const setDifficulty = useGameStore((state) => state.setDifficulty);
  const setNetworkStatus = useGameStore((state) => state.setNetworkStatus);
  const start = useGameStore((state) => state.start);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [difficultyOpen, setDifficultyOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(playerName);
  const [busy, setBusy] = useState(false);
  const joinAttemptedCode = useRef('');
  const inviteHandled = useRef(false);
  const inviteNoticeShown = useRef(false);
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
  const updateNameDraft = (value) => setNameDraft(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12));
  useEffect(() => {
    setNameDraft(playerName);
  }, [playerName]);
  useEffect(() => {
    if (nameDraft === playerName) return;
    const timeout = setTimeout(() => setPlayerName(nameDraft), 350);
    return () => clearTimeout(timeout);
  }, [nameDraft, playerName, setPlayerName]);
  useEffect(() => {
    networkGame.refreshLeaderboard().catch(() => {});
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const openFriends = () => {
      if (!authUser) return;
      setProfileOpen(true);
    };
    window.addEventListener(OPEN_FRIENDS_EVENT, openFriends);
    return () => window.removeEventListener(OPEN_FRIENDS_EVENT, openFriends);
  }, [authUser]);
  useEffect(() => {
    if (typeof window === 'undefined' || inviteHandled.current) return;
    if (!new URLSearchParams(window.location.search).get('invite')) return;
    if (!authUser) {
      if (!inviteNoticeShown.current) {
        inviteNoticeShown.current = true;
        setNetworkStatus('disconnected', 'Sign in to accept invite');
      }
      return;
    }
    inviteHandled.current = true;
    run(() => consumeInviteFromUrl());
  }, [authUser]);
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
  const startOffline = (botId) => {
    setDifficulty(botId);
    setDifficultyOpen(false);
    start();
  };
  const tier = rankTier(rankedProfile?.rating);
  const showTestAi = import.meta.env.DEV;
  const menuActions = [
    ['OFFLINE', () => setDifficultyOpen(true), false],
    ['QUICK MATCH', () => run(() => networkGame.quickMatch()), false],
    ['RANKED', () => run(() => networkGame.rankedMatch()), !authUser],
    showTestAi && ['TEST AI ONLINE', () => run(() => networkGame.testAiMatch(difficulty)), false],
  ].filter(Boolean);
  if (started || !revealed) return null;
  return (
    <>
    <div className="pointer-events-auto fixed inset-x-3 bottom-4 z-[7] mx-auto grid max-w-2xl gap-3 rounded-3xl border border-foreground/10 bg-background/78 p-3 text-center shadow-xl shadow-background/25 backdrop-blur-sm" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        <button className="text-foreground underline-offset-4 hover:underline" onClick={() => setNameOpen(true)} disabled={busy}>{playerName || 'PLAYER'}</button>
        <span>{rankedProfile ? `${tier.name} ${rankedProfile.rating}` : 'RANK ...'}</span>
        {authUser && <Button variant="ghost" size="sm" className="rounded-full px-3 text-[11px]" onClick={() => setProfileOpen(true)} disabled={busy}>PROFILE</Button>}
        {networkStatus === 'connecting' && <span>CONNECTING</span>}
        {networkStatus === 'waiting' && <span className="inline-flex items-center gap-2"><Spinner className="size-3" /> SEARCHING{rankedQueueCount ? ` ${rankedQueueCount}/2` : ''}</span>}
        {networkError && <span className="text-destructive">{networkError}</span>}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {menuActions.map(([label, onClick, disabled]) => (
          <Button variant="ghost" size="sm" key={label} className="rounded-full px-3 text-[11px]" onClick={onClick} disabled={busy || disabled}>{label}</Button>
        ))}
        <Button variant="ghost" size="sm" className="rounded-full px-3 text-[11px]" onClick={() => run(() => networkGame.createPrivate())} disabled={busy}>ROOM</Button>
        <Input className="h-7 w-20 rounded-full bg-background/60 text-center text-[11px] uppercase tracking-[0.18em]" value={code} onChange={(event) => updateCode(event.target.value)} placeholder="CODE" maxLength={5} />
      </div>
    </div>
    {nameOpen && (
      <div className="fixed inset-0 z-20 grid place-items-center bg-background/50 p-4 backdrop-blur-sm" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
        <section className={cn(glassPanel, 'grid w-[min(420px,92vw)] gap-4')}>
          <div className="grid gap-1 text-center">
            <h2 className={labelText}>PLAYER</h2>
            <p className="text-xs text-muted-foreground">Change display name or sign in.</p>
          </div>
          <Input
            className="text-center font-medium uppercase tracking-[0.18em]"
            value={nameDraft}
            onChange={(event) => updateNameDraft(event.target.value)}
            onBlur={() => nameDraft !== playerName && setPlayerName(nameDraft)}
            placeholder="NAME"
            maxLength={12}
            aria-label="player name"
          />
          {authUser ? (
            <div className={row}>
              <span className="text-xs text-muted-foreground">SIGNED IN AS <b>{authUser.name}</b></span>
              <Button variant="outline" size="sm" onClick={() => run(() => networkGame.signOut())} disabled={busy}>LOG OUT</Button>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Input className="text-center" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" aria-label="email" />
                <Input className="text-center" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="PASSWORD" type="password" aria-label="password" />
              </div>
              <div className={row}>
                <Button variant="outline" size="sm" onClick={() => run(() => networkGame.signIn(email, password))} disabled={busy || !email || !password}>SIGN IN</Button>
                <Button variant="outline" size="sm" onClick={() => run(() => networkGame.register(email, password))} disabled={busy || !email || !password}>REGISTER</Button>
              </div>
            </>
          )}
          <Button size="sm" onClick={() => { if (nameDraft !== playerName) setPlayerName(nameDraft); setNameOpen(false); }}>DONE</Button>
        </section>
      </div>
    )}
    {difficultyOpen && (
      <div className="fixed inset-0 z-20 grid place-items-center bg-background/50 p-4 backdrop-blur-sm" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
        <section className={cn(glassPanel, 'grid w-[min(460px,92vw)] gap-4')}>
          <div className="grid gap-1 text-center">
            <h2 className={labelText}>SELECT DIFFICULTY</h2>
            <p className="text-xs text-muted-foreground">Choose bot level for offline match.</p>
          </div>
          <div className={row}>
            {BOTS.map((bot) => (
              <Button
                variant="outline"
                size="sm"
                key={bot.id}
                className={cn('uppercase tracking-[0.16em]', bot.id === difficulty && activeButton)}
                onClick={() => startOffline(bot.id)}
                title={bot.tag}
              >
                {bot.name}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setDifficultyOpen(false)}>CANCEL</Button>
        </section>
      </div>
    )}
    <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} leaderboard={leaderboard} />
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
  const setLivePlayerCount = useGameStore((state) => state.setLivePlayerCount);

  const bot = BOTS.find((item) => item.id === difficulty) ?? BOTS[1];
  const botName = bot.name;
  const botIndex = Math.max(0, BOTS.findIndex((item) => item.id === bot.id));
  const nextBot = BOTS[botIndex + 1];
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
      ? nextBot
        ? `WARMED UP - ${nextBot.name} IS WAITING`
        : 'FLAWLESS - NOTHING LEFT TO PROVE'
      : delta <= 2
        ? 'SO CLOSE - RUN IT BACK'
        : `THE ${botName} HAD YOUR NUMBER`;
  const firstServe = phase === 'serve' && scoreP === 0 && scoreAI === 0;
  const serveMessage = mode === 'online' && networkStatus === 'waiting'
    ? 'WAITING FOR OPPONENT'
    : phase === 'serve' ? (server === 'player' ? 'HOLD · RELEASE TO SERVE' : `${opponentName} SERVES`) : '';

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      refreshLivePlayerPresence()
        .then((data) => {
          if (!cancelled) setLivePlayerCount(Math.max(0, Number(data?.players) || 0));
        })
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setLivePlayerCount]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[5]">
      <ReplayControls />
      {started && menuOpen && phase !== 'over' && <div className="fixed inset-0 bg-background/18" aria-hidden />}

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
          {serveMessage && <div className="absolute left-1/2 top-[63%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium tracking-[0.34em] text-muted-foreground">{serveMessage}</div>}
          {flashText && phase !== 'over' && (
            <div key={flashId} className="pointer-events-none absolute left-1/2 top-1/3 whitespace-nowrap text-5xl font-medium tracking-[0.14em] [animation:hudPop_1s_cubic-bezier(.2,1.3,.3,1)_forwards]" style={{ color: flashColor, textShadow: `0 0 30px ${flashColor}55` }}>
              {flashText}
            </div>
          )}
          <ChargeDial />
          {mode === 'online' && <EmoteBubbles />}
          {firstServe && <div className="absolute bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tracking-[0.28em] text-muted-foreground">MOVE&nbsp;TO&nbsp;AIM&nbsp;·&nbsp;HOLD&nbsp;CHARGE&nbsp;·&nbsp;FLICK&nbsp;SPIN</div>}
          {!isCoarsePointer && phase !== 'over' && !menuOpen && (
            <div className="pointer-events-none absolute right-5 top-5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/70" aria-hidden>ESC</div>
          )}
        </>
      )}

      {started && menuOpen && phase !== 'over' && (
        <div
          className={cn(glassPanel, 'absolute right-4 top-4 grid w-[min(360px,calc(100vw-2rem))] gap-3')}
          onPointerDown={stop}
          onPointerUp={stop}
          onClick={stop}
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className={labelText}>PAUSED</h3>
            <Button size="sm" className="rounded-full px-4" onClick={toggleMenu}>RESUME</Button>
          </div>
          <PlayerSpeedSetting />
          <PerformanceSettings />
          <div className="flex flex-wrap justify-end gap-2">
            {mode !== 'online' && <Button variant="ghost" size="sm" onClick={newGame}>RESTART</Button>}
            <Button variant="ghost" size="sm" onClick={() => { if (mode === 'online') networkGame.disconnect(); else goHome(); }}>LOBBY</Button>
          </div>
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
    const tick = () => {
      const node = ref.current;
      if (node) {
        node.style.transform = `translate3d(${inputHud.cursorX}px, ${inputHud.cursorY}px, 0)`;
        node.style.opacity = inputHud.cursorVisible ? '1' : '0';
      }
    };
    return subscribeHudFrame(tick);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[10000] size-0 opacity-0 mix-blend-difference transition-opacity duration-150"
      aria-hidden
    >
      <span className="absolute left-0 top-0 h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-white" />
      <span className="absolute left-0 top-0 h-0.5 w-5 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-white" />
    </div>
  );
}

const loadedExitMinMs = 250;
const maxIntroMs = 900;
const introRemoveDelayMs = 150;

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
    <div className={cn('fixed inset-0 z-[9] flex items-center justify-center bg-background transition-opacity duration-150', leaving && 'pointer-events-none opacity-0')}>
      <div className="flex pl-[0.34em] text-[clamp(64px,10vw,150px)] font-semibold tracking-[0.34em] text-[#d9665f]" aria-label="BACKSPIN">
        {'BACKSPIN'.split('').map((letter, index) => (
          <span key={index} className="opacity-0 [animation:introGlyph_180ms_cubic-bezier(.16,.7,.2,1)_forwards]" style={{ animationDelay: `${0.015 + index * 0.012}s` }}>{letter}</span>
        ))}
      </div>
    </div>
  );
}
