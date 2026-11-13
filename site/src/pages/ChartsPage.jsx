// The full charts: every tracked game in one sortable, filterable table.
//
// Everything you choose (list, sort, search, genre, minimum players) lives in
// the web address, e.g. /charts?view=rising&genre=Simulation&min=1000, so any
// view can be bookmarked or shared.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, SearchX } from "lucide-react";
import { useCharts } from "../lib/api.js";
import {
  DEFAULT_VIEW, MIN_PLAYER_OPTIONS, SORTABLE, VIEWS, filterGames, findView, genreOptions, isSortable, sortGames,
} from "../lib/charts.js";
import { formatCompact, formatNumber, formatPercent, timeAgo } from "../lib/format.js";
import { useNow } from "../lib/hooks.js";
import GameIcon from "../components/GameIcon.jsx";
import { ErrorState, Skeleton } from "../components/Feedback.jsx";

const PAGE_SIZE = 50;

export default function ChartsPage() {
  const charts = useCharts();
  const now = useNow();
  const [params, setParams] = useSearchParams();

  // Read the choices from the address bar, falling back to sensible defaults.
  const view = findView(params.get("view"));
  const sort = isSortable(params.get("sort")) ? params.get("sort") : view.sort;
  const dir = ["asc", "desc"].includes(params.get("dir")) ? params.get("dir") : (params.get("sort") ? SORTABLE[sort] : view.dir ?? "desc");
  const query = params.get("q") ?? "";
  const genre = params.get("genre") ?? "";
  const minPlayers = MIN_PLAYER_OPTIONS.includes(Number(params.get("min"))) ? Number(params.get("min")) : 0;
  const [shown, setShown] = useState(PAGE_SIZE);

  /** Change some choices in the address bar. `null` removes one (back to default). */
  function update(changes) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "" || value === undefined) next.delete(key); else next.set(key, value);
      }
      return next;
    }, { replace: true });
    setShown(PAGE_SIZE); // new filters: start from the top again
  }

  function sortBy(key) {
    const nextDir = key === sort ? (dir === "asc" ? "desc" : "asc") : SORTABLE[key];
    update({ sort: key, dir: nextDir });
  }

  const games = charts.data?.games ?? [];
  const rules = charts.data?.rules ?? {};
  const genres = useMemo(() => genreOptions(games), [games]);
  const rows = useMemo(
    () => sortGames(filterGames(games, { view, rules, query, genre, minPlayers }), sort, dir),
    [games, view, rules, query, genre, minPlayers, sort, dir],
  );

  return (
    <>
      <title>{`${view.title} · Charts · Roblox Game Tracker`}</title>

      <section className="charts-head">
        <h1>Charts</h1>
        <p className="muted">
          Every game the tracker records, updated hourly.
          {charts.data?.at && <> Last updated {timeAgo(charts.data.at, now)}.</>}
        </p>
      </section>

      {/* Which list. Scrolls sideways on phones rather than squashing. */}
      <div className="view-tabs" role="group" aria-label="Chart">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" aria-pressed={v.key === view.key}
                  onClick={() => update({ view: v.key === DEFAULT_VIEW ? null : v.key, sort: null, dir: null })}>
            {v.title}
          </button>
        ))}
      </div>

      {charts.isError ? (
        <ErrorState error={charts.error} onRetry={charts.refetch} />
      ) : (
        <section className="card charts-card" aria-labelledby="view-title">
          <div className="charts-card-head">
            <h2 id="view-title">{view.title}</h2>
            {charts.data && <p className="muted small">{view.describe(rules)}</p>}
          </div>

          {/* Filters: one row above the table they affect. */}
          <div className="filters">
            <input type="search" className="filter-input" placeholder="Filter by name or creator…"
                   aria-label="Filter by name or creator" value={query}
                   onChange={(e) => update({ q: e.target.value })} />
            <select className="filter-select" aria-label="Genre" value={genre}
                    onChange={(e) => update({ genre: e.target.value })}>
              <option value="">All genres</option>
              {genres.map((g) => <option key={g.genre} value={g.genre}>{g.genre} ({g.count})</option>)}
            </select>
            <select className="filter-select" aria-label="Minimum players" value={minPlayers}
                    onChange={(e) => update({ min: e.target.value === "0" ? null : e.target.value })}>
              {MIN_PLAYER_OPTIONS.map((n) => (
                <option key={n} value={n}>{n === 0 ? "Any player count" : `${formatCompact(n)}+ playing`}</option>
              ))}
            </select>
            {charts.data && (
              <span className="muted small filter-count" aria-live="polite">
                {/* "All 401 games" when nothing is left out, "328 of 401 games" when something is. */}
                {rows.length === games.length ? `All ${formatNumber(rows.length)} games` : `${formatNumber(rows.length)} of ${formatNumber(games.length)} games`}
              </span>
            )}
          </div>

          {charts.isPending ? (
            <div className="table-skeleton">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={44} />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <SearchX size={24} aria-hidden="true" />
              <p>{emptyMessage(view, games.length)}</p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="data-table charts-table" data-sort={sort}>
                  <thead>
                    <tr>
                      <th scope="col" className="num">#</th>
                      <SortHeader label="Game" column="name" sort={sort} dir={dir} onSort={sortBy} />
                      <SortHeader label="Playing" column="playing" sort={sort} dir={dir} onSort={sortBy} numeric />
                      <SortHeader label="24h" column="change24h" sort={sort} dir={dir} onSort={sortBy} numeric optional
                                  title="Change in players vs. this time yesterday" />
                      <SortHeader label="Visits (24h)" column="visits24h" sort={sort} dir={dir} onSort={sortBy} numeric optional />
                      <SortHeader label="Rating" column="rating" sort={sort} dir={dir} onSort={sortBy} numeric optional />
                      <th scope="col" className="hide-narrow">Genre</th>
                      <SortHeader label="Updated" column="lastUpdated" sort={sort} dir={dir} onSort={sortBy} numeric optional />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((game, i) => (
                      <GameRow key={game.universeId} game={game} rank={i + 1} now={now} />
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > shown && (
                <button type="button" className="button show-more" onClick={() => setShown(shown + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, rows.length - shown)} more
                </button>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}

/** A column heading you can click to sort by. `aria-sort` tells screen readers the current order. */
function SortHeader({ label, column, sort, dir, onSort, numeric = false, optional = false, title }) {
  const active = sort === column;
  const Icon = active && dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <th scope="col" className={columnClass(column, numeric, optional)}
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`sort-button${active ? " is-active" : ""}`} onClick={() => onSort(column)} title={title}>
        {label}
        <Icon size={14} aria-hidden="true" className="sort-icon" />
      </button>
    </th>
  );
}

function GameRow({ game, rank, now }) {
  const change = game.change24h;
  return (
    <tr>
      <td className="num muted">{rank}</td>
      <td className="col-name">
        <Link to={`/game/${game.universeId}`} className="table-game">
          <GameIcon src={game.icon} size={32} />
          <span className="table-game-text">
            <span className="table-game-name">{game.name}</span>
            {game.creatorName && <span className="muted small">{game.creatorName}</span>}
          </span>
        </Link>
      </td>
      <td className="num">{formatNumber(game.playing)}</td>
      <td className={`${columnClass("change24h", true, true)} change${change > 0 ? " is-up" : change < 0 ? " is-down" : ""}`}>
        {change == null ? "—" : (
          <>
            {change > 0 && <ArrowUp size={12} aria-hidden="true" />}
            {change < 0 && <ArrowDown size={12} aria-hidden="true" />}
            {formatPercent(change, { signed: true })}
          </>
        )}
      </td>
      <td className={columnClass("visits24h", true, true)}>{game.visits24h == null ? "—" : `+${formatCompact(game.visits24h)}`}</td>
      <td className={columnClass("rating", true, true)}>{formatPercent(game.rating)}</td>
      <td className="hide-narrow muted">{game.genre ?? "—"}</td>
      <td className={`${columnClass("lastUpdated", true, true)} muted`}>{timeAgo(game.lastUpdated, now)}</td>
    </tr>
  );
}

/**
 * CSS classes for a column. "optional" columns are hidden on phones unless
 * they're the one being sorted by (see .charts-table[data-sort] in styles.css),
 * so the number that matters for the current list is always on screen.
 */
function columnClass(column, numeric, optional) {
  return [numeric && "num", optional && "optional", `col-${column}`].filter(Boolean).join(" ");
}

function emptyMessage(view, total) {
  if (total === 0) return "No games yet. The first hourly update hasn't finished.";
  if (view.key === "rising" || view.key === "visits-today") {
    return "No games match. This list needs 24 hours of history, or try loosening your filters.";
  }
  return "No games match these filters.";
}
