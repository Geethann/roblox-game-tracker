// Home: the visitor's main game (if they've picked one) and the four charts.
import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { ArrowRight, Clock, Flame, GitCompareArrows, Sparkles, ThumbsUp, TrendingUp, Users, X } from "lucide-react";
import { useGame, useHistory, useLeaderboards } from "../lib/api.js";
import { formatCompact, formatNumber, formatPercent, timeAgo } from "../lib/format.js";
import { useMainGame, useNow } from "../lib/hooks.js";
import GameIcon from "../components/GameIcon.jsx";
import { ErrorState, Skeleton } from "../components/Feedback.jsx";

// The trend line uses the chart library; load it only when a main game is shown.
const Sparkline = lazy(() => import("../components/Sparkline.jsx"));

// Each list: where its data is, which charts page "View all" opens,
// how to show its number, and what to say when it's empty.
const NEEDS_A_DAY = "Needs 24 hours of history. Check back tomorrow.";
const LISTS = [
  {
    key: "mostPlayed", view: "most-played", title: "Most played", icon: Users,
    hint: "Players online right now",
    show: (game) => `${formatCompact(game.value)} playing`,
  },
  {
    key: "trendingOnRoblox", view: "trending-on-roblox", title: "Trending on Roblox", icon: Sparkles,
    hint: "Roblox's own Trending list, in Roblox's order",
    show: (game) => `${formatCompact(game.playing)} playing`,
    empty: "Roblox's list arrives with the next hourly update.",
  },
  {
    key: "rising", view: "rising", title: "Rising", icon: TrendingUp,
    hint: "Biggest rise in players vs. this time yesterday",
    show: (game) => formatPercent(game.value, { signed: true }),
    positive: true,
    empty: NEEDS_A_DAY,
  },
  {
    key: "mostVisits24h", view: "visits-today", title: "Most visits today", icon: Flame,
    hint: "New visits in the last 24 hours",
    show: (game) => `+${formatCompact(game.value)}`,
    empty: NEEDS_A_DAY,
  },
  {
    key: "topRated", view: "top-rated", title: "Top rated", icon: ThumbsUp,
    hint: "Highest share of likes (popular games only)",
    show: (game) => formatPercent(game.value),
  },
  {
    key: "recentlyUpdated", view: "recently-updated", title: "Recently updated", icon: Clock,
    hint: "Latest updates published by developers",
    show: (game, now) => timeAgo(game.value, now),
  },
];

export default function HomePage() {
  const leaderboards = useLeaderboards();
  const [mainGame] = useMainGame();
  const now = useNow();

  return (
    <>
      <title>Roblox Game Tracker · Live stats and history for any game</title>

      <section className="hero">
        <h1>Track any Roblox game</h1>
        <p>Live player counts, visits and history. Pick a main game and see how it compares.</p>
      </section>

      {mainGame && <MainGameCard universeId={mainGame.universeId} />}

      <section>
        <div className="section-head">
          <h2>Charts</h2>
          {leaderboards.data?.at && (
            <span className="muted small">Updated {timeAgo(leaderboards.data.at, now)}</span>
          )}
        </div>
        {leaderboards.isError ? (
          <ErrorState error={leaderboards.error} onRetry={leaderboards.refetch} />
        ) : (
          <div className="leaderboards">
            {LISTS.map((list) => (
              <Leaderboard key={list.key} list={list} now={now} loading={leaderboards.isPending}
                           games={leaderboards.data?.lists?.[list.key]} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Leaderboard({ list, games, loading, now }) {
  const Icon = list.icon;
  return (
    <div className="card leaderboard">
      <div className="leaderboard-head">
        <h3><Icon size={18} aria-hidden="true" /> {list.title}</h3>
        <Link to={`/charts?view=${list.view}`} className="view-all" aria-label={`View all: ${list.title}`}>
          View all <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <p className="muted small">{list.hint}</p>
      {loading ? (
        <div className="leaderboard-skeleton">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={32} />)}
        </div>
      ) : games?.length ? (
        <ol className="leaderboard-list">
          {games.slice(0, 10).map((game, i) => (
            <li key={game.universeId}>
              <Link to={`/game/${game.universeId}`} className="leaderboard-row">
                <span className="rank">{i + 1}</span>
                <GameIcon src={game.icon} size={32} />
                <span className="leaderboard-name">{game.name}</span>
                <span className={`leaderboard-value${list.positive && game.value > 0 ? " positive" : ""}`}>
                  {list.show(game, now)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">{list.empty ?? "Nothing here yet."}</p>
      )}
    </div>
  );
}

/**
 * The visitor's main game: live numbers, its rank, 24h change, a 7-day trend
 * line, and shortcuts to its page and to the compare page.
 */
function MainGameCard({ universeId }) {
  const game = useGame(universeId);
  const week = useHistory(universeId, "7d");
  const [, setMainGame] = useMainGame();
  const g = game.data;
  const trend = week.data?.universeId === Number(universeId)
    ? week.data.points.map((p) => p.playing).filter((v) => v != null)
    : [];
  const change = g?.change24h;

  return (
    <section className="card main-game-card">
      <div className="main-game-top">
        <span className="main-game-label">Your main game</span>
        <button type="button" className="icon-button icon-button-small" onClick={() => setMainGame(null)}
                aria-label="Remove main game" title="Remove main game">
          <X size={16} />
        </button>
      </div>
      {game.isPending ? (
        <Skeleton height={64} />
      ) : game.isError ? (
        <p className="muted">Couldn&apos;t load your main game: {game.error.message}</p>
      ) : (
        <div className="main-game-body">
          <Link to={`/game/${universeId}`} className="main-game-link">
            <GameIcon src={g.icon} size={56} />
            <span>
              <span className="main-game-name">{g.name}</span>
              <span className="muted small">
                {g.rank ? `#${formatNumber(g.rank.position)} most played of ${formatNumber(g.rank.of)}` : "Not ranked yet"}
              </span>
            </span>
          </Link>
          <div className="main-game-stats">
            <div>
              <div className="main-game-stat-label"><span className="live-dot" aria-hidden="true" />Playing now</div>
              <div className="main-game-stat">{formatNumber(g.playing)}</div>
            </div>
            <div>
              <div className="main-game-stat-label">vs yesterday</div>
              <div className={`main-game-stat${change > 0 ? " is-up" : change < 0 ? " is-down" : ""}`}>
                {change == null ? "—" : formatPercent(change, { signed: true })}
              </div>
            </div>
            {trend.length >= 2 && (
              <Suspense fallback={null}>
                <div className="main-game-trend">
                  <div className="main-game-stat-label">Last 7 days</div>
                  <Sparkline values={trend} label={`Players over the last 7 days, now ${formatNumber(g.playing)}`} />
                </div>
              </Suspense>
            )}
          </div>
          <Link to={`/compare?main=${universeId}`} className="button">
            <GitCompareArrows size={16} aria-hidden="true" /> Compare
          </Link>
        </div>
      )}
    </section>
  );
}
