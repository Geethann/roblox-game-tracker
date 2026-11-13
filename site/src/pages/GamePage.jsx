// One game's page: who made it, its live numbers, and (next step) its history chart.
import { useEffect } from "react";
import { useParams } from "react-router";
import { ExternalLink, Star } from "lucide-react";
import { useGame } from "../lib/api.js";
import { formatCompact, formatDate, formatNumber, formatPercent, likeRatio, timeAgo } from "../lib/format.js";
import { useMainGame, useNow, useRecentGames } from "../lib/hooks.js";
import GameIcon from "../components/GameIcon.jsx";
import { ErrorState, Notice, Skeleton } from "../components/Feedback.jsx";
import NotFoundPage from "./NotFoundPage.jsx";

export default function GamePage() {
  const { universeId } = useParams();
  const isValidId = /^\d{1,15}$/.test(universeId);
  const game = useGame(isValidId ? universeId : null);
  const [, rememberRecent] = useRecentGames();
  const now = useNow();

  // Add this game to "Recently viewed" in the search box.
  const loaded = game.data;
  useEffect(() => {
    if (loaded) {
      rememberRecent({
        universeId: loaded.universeId, name: loaded.name,
        icon: loaded.icon, creatorName: loaded.creatorName,
      });
    }
  }, [loaded?.universeId]); // only when a different game loads, not on every refresh

  if (!isValidId || game.error?.status === 404) {
    return <NotFoundPage message="We couldn't find a Roblox game with that ID." />;
  }
  if (game.isError) return <ErrorState error={game.error} onRetry={game.refetch} />;
  if (game.isPending) return <GamePageSkeleton />;

  const g = game.data;
  const startedRecently = g.trackedSince && now / 1000 - g.trackedSince < 2 * 3600;

  return (
    <>
      <title>{`${g.name} · Roblox Game Tracker`}</title>

      <div className="game-header">
        <GameIcon src={g.icon} size={88} />
        <div className="game-title">
          <h1>{g.name}</h1>
          <p className="muted">by {g.creatorName ?? "unknown creator"}</p>
          <p className="game-dates muted small">
            <span>Created {formatDate(g.createdAt)}</span>
            <span>Updated {timeAgo(g.lastUpdated, now)}</span>
            {g.trackedSince && <span>Tracked since {formatDate(g.trackedSince)}</span>}
          </p>
        </div>
        <div className="game-actions">
          <MainGameButton game={g} />
          <a className="button" href={`https://www.roblox.com/games/${g.rootPlaceId}`}
             target="_blank" rel="noreferrer">
            Open on Roblox <ExternalLink size={16} aria-hidden="true" />
          </a>
        </div>
      </div>

      {!g.isTracking && (
        <Notice>The tracker is full right now, so this game&apos;s history isn&apos;t being recorded. Live numbers still update.</Notice>
      )}
      {g.isTracking && startedRecently && (
        <Notice>We started tracking this game {timeAgo(g.trackedSince, now)}. Its history builds up from here, one reading an hour.</Notice>
      )}

      <div className="stat-grid">
        <StatCard label="Playing now" live value={formatNumber(g.playing)}
                  footnote={`Updated ${timeAgo(g.fetchedAt, now)}`} />
        <StatCard label="Total visits" value={formatCompact(g.visits)} exact={formatNumber(g.visits)} />
        <StatCard label="Favourites" value={formatCompact(g.favorites)} exact={formatNumber(g.favorites)} />
        <StatCard label="Rating" value={formatPercent(likeRatio(g.likes, g.dislikes))}
                  footnote={`${formatCompact(g.likes)} likes · ${formatCompact(g.dislikes)} dislikes`} />
      </div>
    </>
  );
}

function StatCard({ label, value, exact, footnote, live = false }) {
  return (
    <div className="card stat">
      <div className="stat-label">
        {live && <span className="live-dot" aria-hidden="true" />}
        {label}
      </div>
      {/* `exact` shows the full number on hover, e.g. 19,638,378,371 for "19.6B". */}
      <div className="stat-value" title={exact}>{value}</div>
      {footnote && <div className="stat-footnote">{footnote}</div>}
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
    <div aria-busy="true" aria-label="Loading game">
      <div className="game-header">
        <Skeleton width={88} height={88} radius={16} />
        <div className="game-title">
          <Skeleton width="60%" height={28} />
          <Skeleton width="30%" />
        </div>
      </div>
      <div className="stat-grid">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={104} radius={12} />)}
      </div>
    </div>
  );
}
