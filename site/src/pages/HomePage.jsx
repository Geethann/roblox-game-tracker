// Home: the visitor's main game (if they've picked one) and the four charts.
import { Link } from "react-router";
import { Clock, Flame, TrendingUp, Users, X } from "lucide-react";
import { useGame, useLeaderboards } from "../lib/api.js";
import { formatCompact, formatPercent, timeAgo } from "../lib/format.js";
import { useMainGame, useNow } from "../lib/hooks.js";
import GameIcon from "../components/GameIcon.jsx";
import { ErrorState, Skeleton } from "../components/Feedback.jsx";

// Each list: where its data is, how to show its number, and what to say when it's empty.
const LISTS = [
  {
    key: "mostPlayed", title: "Most played", icon: Users,
    hint: "Players online right now",
    show: (game) => `${formatCompact(game.value)} playing`,
  },
  {
    key: "mostVisits24h", title: "Most visits today", icon: Flame,
    hint: "New visits in the last 24 hours",
    show: (game) => `+${formatCompact(game.value)}`,
    empty: "Needs 24 hours of history. Check back tomorrow.",
  },
  {
    key: "trending", title: "Trending", icon: TrendingUp,
    hint: "Biggest rise in players vs. this time yesterday",
    show: (game) => formatPercent(game.value, { signed: true }),
    positive: true,
    empty: "Needs 24 hours of history. Check back tomorrow.",
  },
  {
    key: "recentlyUpdated", title: "Recently updated", icon: Clock,
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
      <h3><Icon size={18} aria-hidden="true" /> {list.title}</h3>
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

/** The visitor's main game, with its live numbers. */
function MainGameCard({ universeId }) {
  const game = useGame(universeId);
  const [, setMainGame] = useMainGame();

  return (
    <section className="card main-game-card">
      <div className="main-game-label">Your main game</div>
      {game.isPending ? (
        <Skeleton height={56} />
      ) : game.isError ? (
        <p className="muted">Couldn&apos;t load your main game: {game.error.message}</p>
      ) : (
        <div className="main-game-body">
          <Link to={`/game/${universeId}`} className="main-game-link">
            <GameIcon src={game.data.icon} size={56} />
            <span>
              <span className="main-game-name">{game.data.name}</span>
              <span className="muted small">
                <span className="live-dot" aria-hidden="true" />
                {formatCompact(game.data.playing)} playing · {formatCompact(game.data.visits)} visits
              </span>
            </span>
          </Link>
          <button type="button" className="icon-button" onClick={() => setMainGame(null)}
                  aria-label="Remove main game" title="Remove main game">
            <X size={18} />
          </button>
        </div>
      )}
    </section>
  );
}
