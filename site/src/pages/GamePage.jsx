// One game's page: header, range picker, stat cards, history chart, updates and About.
//
// The chosen range and chart measure live in the web address
// (e.g. /game/123?range=30d&metric=visits), so a copied link opens exactly
// the same view for whoever you send it to.
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowDown, ArrowRight, ArrowUp, ExternalLink, GitCompareArrows, Star } from "lucide-react";
import { useGame, useHistory } from "../lib/api.js";
import {
  formatCompact, formatDate, formatNumber, formatPercent, likeRatio, timeAgo,
} from "../lib/format.js";
import {
  DEFAULT_RANGE, RANGES, isMetric, isRange, preparePoints, rangeStart, summarise,
} from "../lib/history.js";
import { useMainGame, useNow, useRecentGames } from "../lib/hooks.js";
import { playersVsMain, ratingVsMain } from "../lib/compare.js";
import GameIcon from "../components/GameIcon.jsx";
import InfoTip from "../components/InfoTip.jsx";
import ShareButton from "../components/ShareButton.jsx";
import HistoryPanel from "../components/HistoryPanel.jsx";
import EventTimeline from "../components/EventTimeline.jsx";
import AboutGame from "../components/AboutGame.jsx";
import { ErrorState, Notice, Skeleton } from "../components/Feedback.jsx";
import NotFoundPage from "./NotFoundPage.jsx";

// Why a game isn't being tracked (the backend's safeguards), in plain words.
const NOT_TRACKED = {
  quiet: "This game isn't being tracked yet: it has no players right now and under 1,000 visits. Live numbers still update, and it'll start being tracked once it picks up.",
  busy: "Lots of new games have been added recently, so this one isn't being tracked yet. Live numbers still update; try again a little later.",
  full: "The tracker is full right now, so this game's history isn't being recorded. Live numbers still update.",
};

const RANGE_PHRASES = {
  "24h": "in the last 24 hours", "7d": "in the last 7 days", "30d": "in the last 30 days",
  "90d": "in the last 90 days", "1y": "in the last year", ytd: "this year", all: "since tracking began",
};

export default function GamePage() {
  const { universeId } = useParams();
  const isValidId = /^\d{1,15}$/.test(universeId);
  const now = useNow();

  // Range and measure come from the address bar (?range=30d&metric=visits).
  const [params, setParams] = useSearchParams();
  const range = isRange(params.get("range")) ? params.get("range") : DEFAULT_RANGE;
  const metric = isMetric(params.get("metric")) ? params.get("metric") : "players";
  function setParam(key, value, defaultValue) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value === defaultValue) next.delete(key); else next.set(key, value);
      return next;
    }, { replace: true }); // don't fill the Back button with every click
  }

  const game = useGame(isValidId ? universeId : null);
  const history = useHistory(isValidId ? universeId : null, range);
  const [highlightedEvent, setHighlightedEvent] = useState(null);

  // While another game's history is still showing (just navigated here), don't use it.
  const historyIsCurrent = history.data?.universeId === Number(universeId);
  const resolution = historyIsCurrent ? history.data.resolution : null;
  const points = useMemo(
    () => (historyIsCurrent ? preparePoints(history.data.points, resolution, now / 1000) : []),
    [historyIsCurrent, history.data, resolution, now],
  );
  const events = historyIsCurrent ? history.data.events : [];
  const summary = useMemo(() => summarise(points), [points]);

  // Opening a game we weren't tracking starts tracking it and saves its first
  // reading. The history request may have been answered just before that
  // happened (both load at once), so ask for the history again, once.
  const trackedSince = game.data?.trackedSince;
  const historyIsEmpty = historyIsCurrent && history.data.points.length === 0;
  const { refetch: refetchHistory } = history;
  useEffect(() => {
    if (trackedSince && historyIsEmpty) refetchHistory();
  }, [trackedSince, historyIsEmpty, refetchHistory]);

  // Add this game to "Recently viewed" in the search box.
  const [, rememberRecent] = useRecentGames();
  // Only these four values are saved, so the effect only re-runs if one changes
  // (not on every minute's refresh of the live numbers).
  const { universeId: recentId, name: recentName, icon: recentIcon, creatorName: recentCreator } = game.data ?? {};
  useEffect(() => {
    if (recentId) {
      rememberRecent({ universeId: recentId, name: recentName, icon: recentIcon, creatorName: recentCreator });
    }
  }, [recentId, recentName, recentIcon, recentCreator, rememberRecent]);

  if (!isValidId || game.error?.status === 404) {
    return <NotFoundPage message="We couldn't find a Roblox game with that ID." />;
  }
  if (game.isError) return <ErrorState error={game.error} onRetry={game.refetch} />;
  if (game.isPending) return <GamePageSkeleton />;

  const g = game.data;

  // If the game was tracked for less time than the chosen range, the "change"
  // figures only cover the tracked part, so say "since <date>" instead.
  const historyStartsLate = g.trackedSince && g.trackedSince > rangeStart(range, now) + 3_600;
  const phrase = historyStartsLate && summary ? `since ${formatDate(summary.from)}` : RANGE_PHRASES[range];

  return (
    <>
      <title>{`${g.name} · Roblox Game Tracker`}</title>

      <div className="game-header">
        <GameIcon src={g.icon} size={88} />
        <div className="game-title">
          <h1>{g.name}</h1>
          <p className="muted">by {g.creatorName ?? "unknown creator"}{g.genre && ` · ${g.genre}`}</p>
          <p className="game-dates muted small">
            {g.rank && (
              <span className="rank-badge">
                #{formatNumber(g.rank.position)} most played
                <span className="muted"> of {formatNumber(g.rank.of)} tracked</span>
              </span>
            )}
            <span>Updated {timeAgo(g.lastUpdated, now)}</span>
            {g.trackedSince && (
              <span>
                Tracked since {formatDate(g.trackedSince)}{" "}
                <InfoTip label="About tracking" text="Recorded hourly from this date. Roblox doesn't provide history from before then." />
              </span>
            )}
          </p>
        </div>
        <div className="game-actions">
          <MainGameButton game={g} />
          <CompareButton game={g} />
          <a className="button" href={`https://www.roblox.com/games/${g.rootPlaceId}`} target="_blank" rel="noreferrer">
            Open on Roblox <ExternalLink size={16} aria-hidden="true" />
          </a>
        </div>
      </div>

      <VsMainStrip game={g} />

      {!g.isTracking && <Notice>{NOT_TRACKED[g.notTrackedReason] ?? NOT_TRACKED.full}</Notice>}

      {/* The range picker sits above everything it changes: the cards and the chart. */}
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={r.key === range}
                    onClick={() => setParam("range", r.key, DEFAULT_RANGE)}>
              {r.label}
            </button>
          ))}
        </div>
        <ShareButton />
      </div>

      <div className="stat-grid">
        <StatCard label="Playing now" live value={formatNumber(g.playing)}
                  footnote={`Updated ${timeAgo(g.fetchedAt, now)}`} />
        <StatCard
          label="Peak (hourly)"
          info="Players are checked once an hour, so short spikes between checks can be missed."
          value={summary?.peak != null ? formatNumber(summary.peak) : "—"}
          footnote={peakFootnote(summary, phrase, historyStartsLate)}
        />
        <StatCard label="Total visits" value={formatCompact(g.visits)} exact={formatNumber(g.visits)}
                  change={summary?.visitsGained}
                  changeText={summary?.visitsGained != null && `${signed(formatCompact(summary.visitsGained))} ${phrase}`} />
        <StatCard label="Favourites" value={formatCompact(g.favorites)} exact={formatNumber(g.favorites)}
                  change={summary?.favoritesGained}
                  changeText={summary?.favoritesGained != null
                    && `${signed(formatCompact(summary.favoritesGained))} (${formatPercent(summary.favoritesChange, { signed: true })}) ${phrase}`} />
        <StatCard label="Rating" value={formatPercent(likeRatio(g.likes, g.dislikes))}
                  change={ratingPoints(summary?.ratingChange)}
                  changeText={summary?.ratingChange != null && `${signedPoints(summary.ratingChange)} ${phrase}`}
                  footnote={`${formatCompact(g.likes)} likes · ${formatCompact(g.dislikes)} dislikes`} />
      </div>

      {history.isError ? (
        <ErrorState error={history.error} onRetry={history.refetch} />
      ) : (
        <HistoryPanel
          game={g} points={points} resolution={resolution} events={events}
          metricKey={metric} onMetricChange={(key) => setParam("metric", key, "players")}
          rangeKey={range} historyStartsLate={historyStartsLate}
          loading={!historyIsCurrent} updating={history.isFetching && history.isPlaceholderData}
          highlightedEvent={highlightedEvent}
        />
      )}

      <div className="game-columns">
        <EventTimeline events={events} highlighted={highlightedEvent} onHighlight={setHighlightedEvent} now={now} />
        <AboutGame game={g} />
      </div>
    </>
  );
}

/** "in the last 7 days · 13 Nov", but without repeating a date already in the phrase. */
function peakFootnote(summary, phrase, historyStartsLate) {
  if (!summary?.peakAt) return phrase;
  const peakDay = formatDate(summary.peakAt);
  if (historyStartsLate && peakDay === formatDate(summary.from)) return phrase; // "since 13 Nov" already says it
  return `${phrase} · ${peakDay}`;
}

/** "+1.2M" for positive numbers (formatCompact already adds "-" for negatives). */
const signed = (text) => (text.startsWith("-") || text === "—" || text === "0" ? text : `+${text}`);

/** A change in rating as percentage points, rounded to 0.1: 0.0023 -> 0.2 */
const ratingPoints = (change) => (change == null ? null : Math.round(change * 1000) / 10);

/** e.g. "+0.2 pts" (percentage points, not percent). Rounds to 0 -> "No change". */
function signedPoints(change) {
  const points = ratingPoints(change);
  if (points == null) return "—";
  if (points === 0) return "No change";
  return `${points > 0 ? "+" : ""}${points} pts`;
}

function StatCard({ label, value, exact, footnote, live = false, info, change, changeText }) {
  const direction = change > 0 ? "up" : change < 0 ? "down" : null;
  return (
    <div className="card stat">
      <div className="stat-label">
        {live && <span className="live-dot" aria-hidden="true" />}
        {label}
        {info && <InfoTip label={`About ${label}`} text={info} />}
      </div>
      {/* `exact` shows the full number on hover, e.g. 19,638,378,371 for "19.6B". */}
      <div className="stat-value" title={exact}>{value}</div>
      {changeText && (
        <div className={`stat-change${direction ? ` is-${direction}` : ""}`}>
          {direction === "up" && <ArrowUp size={13} aria-hidden="true" />}
          {direction === "down" && <ArrowDown size={13} aria-hidden="true" />}
          {changeText}
        </div>
      )}
      {footnote && <div className="stat-footnote">{footnote}</div>}
    </div>
  );
}

/** Opens the compare page: against your main game if you have one, otherwise with this game as main. */
function CompareButton({ game }) {
  const [mainGame] = useMainGame();
  const hasOtherMain = mainGame && mainGame.universeId !== game.universeId;
  const to = hasOtherMain
    ? `/compare?main=${mainGame.universeId}&with=${game.universeId}`
    : `/compare?main=${game.universeId}`;
  return (
    <Link to={to} className="button">
      <GitCompareArrows size={16} aria-hidden="true" /> Compare
    </Link>
  );
}

/** "Compared with your main game: 3.2× the players · rating +1.4 pts" (only when you've picked a different main). */
function VsMainStrip({ game }) {
  const [mainGame] = useMainGame();
  const isOther = mainGame && mainGame.universeId !== game.universeId;
  const main = useGame(isOther ? mainGame.universeId : null);
  if (!isOther) return null;

  const m = main.data;
  return (
    <div className="vs-main">
      <span className="vs-main-label">vs your main game</span>
      <span className="vs-main-game">
        <GameIcon src={mainGame.icon} size={22} />
        <span className="vs-main-name">{mainGame.name}</span>
      </span>
      {m ? (
        <>
          <span><strong>{playersVsMain(game.playing, m.playing)}</strong> the players</span>
          <span>Rating <strong>{ratingVsMain(likeRatio(game.likes, game.dislikes), likeRatio(m.likes, m.dislikes))}</strong></span>
        </>
      ) : (
        <span className="muted">Loading…</span>
      )}
      <Link to={`/compare?main=${mainGame.universeId}&with=${game.universeId}`} className="view-all">
        Full comparison <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

/** "Set as main" / "Your main game" toggle. */
function MainGameButton({ game }) {
  const [mainGame, setMainGame] = useMainGame();
  const isMain = mainGame?.universeId === game.universeId;
  return (
    <button
      type="button"
      className={`button${isMain ? " button-active" : ""}`}
      aria-pressed={isMain}
      onClick={() => setMainGame(isMain ? null : { universeId: game.universeId, name: game.name, icon: game.icon })}
    >
      <Star size={16} fill={isMain ? "currentColor" : "none"} aria-hidden="true" />
      {isMain ? "Your main game" : "Set as main"}
    </button>
  );
}

function GamePageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading game">
      <div className="game-header">
        <Skeleton width={88} height={88} radius={16} />
        <div className="game-title">
          <Skeleton width="60%" height={28} />
          <Skeleton width="30%" />
        </div>
      </div>
      <Skeleton width={360} height={36} radius={10} />
      <div className="stat-grid">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={112} radius={12} />)}
      </div>
      <Skeleton height={420} radius={12} />
    </div>
  );
}
