// Compare: your main game against up to 4 others, on one chart and side by side.
//
// The whole comparison lives in the web address, e.g.
//   /compare?main=3508322461&with=3808081382,2324662457&range=30d&mode=percent
// so it can be bookmarked or sent to someone and opens exactly the same.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ChartLine, Download, Star, Table2, X } from "lucide-react";
import { useGames, useHistories } from "../lib/api.js";
import {
  MAX_OTHERS, mergeSeries, parseIds, playersVsMain, ratingVsMain, toCompareCsv, useStableSlots,
} from "../lib/compare.js";
import { formatCompact, formatNumber, formatPercent, likeRatio } from "../lib/format.js";
import {
  DEFAULT_RANGE, METRICS, RANGES, downloadFile, formatPointTime, isMetric, isRange, preparePoints, summarise,
} from "../lib/history.js";
import { useMainGame, useNow } from "../lib/hooks.js";
import CompareChart from "../components/CompareChart.jsx";
import GameIcon from "../components/GameIcon.jsx";
import InfoTip from "../components/InfoTip.jsx";
import SearchBox from "../components/SearchBox.jsx";
import ShareButton from "../components/ShareButton.jsx";
import { Skeleton } from "../components/Feedback.jsx";

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const [storedMain] = useMainGame();
  const now = useNow();
  const [view, setView] = useState("chart");

  // Who's being compared: the address first, then the visitor's saved main game.
  const urlMain = parseIds(params.get("main"), { limit: 1 })[0] ?? null;
  const mainId = urlMain ?? storedMain?.universeId ?? null;
  const others = parseIds(params.get("with"), { without: mainId });
  const ids = mainId ? [mainId, ...others] : [];

  const range = isRange(params.get("range")) ? params.get("range") : DEFAULT_RANGE;
  const metricKey = isMetric(params.get("metric")) ? params.get("metric") : "players";
  const metric = METRICS[metricKey];
  // "% change" only makes sense for players; gains per hour and ratings are already comparable.
  const mode = metricKey === "players" && params.get("mode") === "percent" ? "percent" : "actual";

  /** Change choices in the address bar. `null` removes one (back to default). */
  function update(changes) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key); else next.set(key, value);
      }
      return next;
    }, { replace: true });
  }

  // Put the main game in the address too, so "Copy link" shares the whole comparison.
  useEffect(() => {
    if (!urlMain && mainId) update({ main: String(mainId) });
  }, [urlMain, mainId]); // `update` is left out on purpose: it only writes to the address bar

  const gameQueries = useGames(ids);
  const historyQueries = useHistories(ids, range);
  const slots = useStableSlots(ids);

  // Only use answers that belong to the game in that position (lists shift when games are removed).
  const games = ids.map((id, i) => (gameQueries[i]?.data?.universeId === id ? gameQueries[i].data : null));
  const series = ids.map((id, i) => {
    const h = historyQueries[i]?.data;
    return h?.universeId === id ? { id, points: preparePoints(h.points, h.resolution, now / 1000), resolution: h.resolution } : null;
  });
  // A game that fails to load (e.g. an ID Roblox doesn't know) is left off the
  // chart rather than keeping everyone waiting; its chip says what went wrong.
  const failed = ids.map((id, i) => Boolean(gameQueries[i]?.isError || historyQueries[i]?.isError));
  const allLoaded = ids.length > 0 && ids.every((id, i) => failed[i] || (series[i] && games[i]));
  const shown = ids.map((id, i) => i).filter((i) => !failed[i]);
  const resolution = series.find(Boolean)?.resolution ?? "hour";
  const rows = allLoaded ? mergeSeries(shown.map((i) => series[i]), metric.value, mode) : [];
  const updating = historyQueries.some((q) => q.isFetching && q.isPlaceholderData);
  const named = shown.map((i) => ({ universeId: ids[i], name: games[i]?.name ?? `Game ${ids[i]}` }));

  const add = (game) => update({ with: [...others, game.universeId].join(",") });
  const remove = (id) => {
    if (id === mainId) update({ main: String(others[0]), with: others.slice(1).join(",") || null });
    else update({ with: others.filter((o) => o !== id).join(",") || null });
  };
  const makeMain = (id) => update({ main: String(id), with: [mainId, ...others.filter((o) => o !== id)].join(",") });

  if (!mainId) return <PickFirstGame onPick={(game) => update({ main: String(game.universeId) })} />;

  return (
    <>
      <title>Compare · Roblox Game Tracker</title>

      <section className="charts-head">
        <h1>Compare</h1>
        <p className="muted">Your main game against up to {MAX_OTHERS} others. Pick a range, then hover the chart for exact numbers.</p>
      </section>

      {/* The games being compared. Each chip's colour matches its line, so this doubles as the chart's legend. */}
      <div className="compare-games">
        {ids.map((id, i) => (
          <GameChip key={id} id={id} game={games[i]} slot={slots.get(id)} isMain={id === mainId}
                    failed={gameQueries[i]?.isError} canRemove={ids.length > 1}
                    onRemove={() => remove(id)} onMakeMain={() => makeMain(id)} />
        ))}
        {others.length < MAX_OTHERS && (
          <div className="compare-add">
            <SearchBox id="compare-search" onSelect={add} exclude={ids} shortcut={false}
                       placeholder="Add a game to compare…" label="Add a game to compare" />
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={r.key === range}
                    onClick={() => update({ range: r.key === DEFAULT_RANGE ? null : r.key })}>
              {r.label}
            </button>
          ))}
        </div>
        <ShareButton />
      </div>

      <section className="card history" aria-labelledby="compare-title">
        <div className="history-head">
          <h2 id="compare-title">{mode === "percent" ? "Change in players since the start of the range" : metric.title(resolution)}</h2>
          <div className="compare-controls">
            <div className="segmented" role="group" aria-label="What to show">
              {Object.entries(METRICS).map(([key, m]) => (
                <button key={key} type="button" aria-pressed={key === metricKey}
                        onClick={() => update({ metric: key === "players" ? null : key, mode: null })}>
                  {m.label}
                </button>
              ))}
            </div>
            {metricKey === "players" && (
              <div className="segmented" role="group" aria-label="Scale">
                <button type="button" aria-pressed={mode === "actual"} onClick={() => update({ mode: null })}>Actual</button>
                <button type="button" aria-pressed={mode === "percent"} onClick={() => update({ mode: "percent" })}>% change</button>
              </div>
            )}
          </div>
        </div>
        {mode === "percent" && (
          <p className="muted small history-note">
            Each line starts at 0%, so a small game and a huge one can be compared fairly: who grew, and by how much.
          </p>
        )}

        <div className={`history-body${updating ? " is-updating" : ""}`}>
          {!allLoaded ? (
            <Skeleton height={360} radius={8} />
          ) : rows.length < 2 ? (
            <div className="history-empty" style={{ minHeight: 360 }}>
              <ChartLine size={28} aria-hidden="true" />
              <p>Not enough readings for a chart yet.</p>
              <p className="muted small">A new reading is added every hour. Try a longer range.</p>
            </div>
          ) : view === "chart" ? (
            <CompareChart rows={rows} games={named} slots={slots} metric={metric} mode={mode}
                          resolution={resolution} mainId={mainId} />
          ) : (
            <CompareTable rows={rows} games={named} metric={metric} mode={mode} resolution={resolution} />
          )}
        </div>

        <div className="history-foot">
          <span className="history-actions">
            <button type="button" className="button button-small" disabled={rows.length < 2}
                    onClick={() => setView(view === "chart" ? "table" : "chart")}>
              {view === "chart" ? <><Table2 size={15} aria-hidden="true" /> Table</> : <><ChartLine size={15} aria-hidden="true" /> Chart</>}
            </button>
            <button type="button" className="button button-small" disabled={rows.length === 0}
                    onClick={() => downloadFile(`compare-${metricKey}-${range}.csv`, toCompareCsv(rows, named, resolution))}>
              <Download size={15} aria-hidden="true" /> CSV
            </button>
          </span>
        </div>
      </section>

      <SideBySide ids={ids} games={games} series={series} slots={slots} mainId={mainId} range={range} />
    </>
  );
}

/** One game in the comparison: its colour, name, and buttons to make it main or remove it. */
function GameChip({ id, game, slot, isMain, failed, canRemove, onRemove, onMakeMain }) {
  const name = game?.name ?? (failed ? "Game not found" : "Loading…");
  return (
    <div className={`compare-chip${isMain ? " is-main" : ""}`}>
      <span className={`chip-swatch series-bg-${slot}`} aria-hidden="true" />
      <GameIcon src={game?.icon} size={24} />
      <Link to={`/game/${id}`} className="chip-name">{name}</Link>
      {isMain ? (
        <span className="chip-main"><Star size={13} fill="currentColor" aria-hidden="true" /> Main</span>
      ) : (
        <button type="button" className="chip-button" onClick={onMakeMain}
                aria-label={`Make ${name} the main game`} title="Make this the main game">
          <Star size={14} aria-hidden="true" />
        </button>
      )}
      {canRemove && (
        <button type="button" className="chip-button" onClick={onRemove}
                aria-label={`Remove ${name} from the comparison`} title="Remove">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The chart's numbers as a table: one column per game. */
function CompareTable({ rows, games, metric, mode, resolution }) {
  const format = mode === "percent" ? (v) => formatPercent(v, { signed: true }) : metric.format;
  return (
    <div className="history-table-wrap" style={{ maxHeight: 360 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{resolution === "day" ? "Day" : "Time"}</th>
            {games.map((g) => <th key={g.universeId} scope="col" className="num">{g.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.t}>
              <td>{formatPointTime(row.t, resolution)}</td>
              {games.map((g) => <td key={g.universeId} className="num">{row[g.universeId] == null ? "—" : format(row[g.universeId])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RANGE_WORDS = { "24h": "24h", "7d": "7 days", "30d": "30 days", "90d": "90 days", "1y": "year", ytd: "this year", all: "all time" };

/** Side by side: the key numbers for each game, and how each compares with the main game. */
function SideBySide({ ids, games, series, slots, mainId, range }) {
  const main = games[0];
  const mainRating = main && likeRatio(main.likes, main.dislikes);
  return (
    <section className="card charts-card" aria-labelledby="side-title">
      <div className="charts-card-head">
        <h2 id="side-title">Side by side</h2>
        <p className="muted small">Live numbers, plus figures for the chosen range ({RANGE_WORDS[range]}). &ldquo;vs main&rdquo; compares each game with your main game.</p>
      </div>
      <div className="table-scroll">
        <table className="data-table charts-table side-table">
          <thead>
            <tr>
              <th scope="col">Game</th>
              <th scope="col" className="num">Playing now</th>
              <th scope="col" className="num">vs main</th>
              <th scope="col" className="num">Peak (hourly) <InfoTip label="About Peak (hourly)" text="Players are checked once an hour, so short spikes between checks can be missed." /></th>
              <th scope="col" className="num">Visits gained</th>
              <th scope="col" className="num">Rating</th>
              <th scope="col" className="num">vs main</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id, i) => {
              const g = games[i];
              const summary = series[i] ? summarise(series[i].points) : null;
              const rating = g && likeRatio(g.likes, g.dislikes);
              const isMain = id === mainId;
              return (
                <tr key={id}>
                  <td className="col-name">
                    <span className="table-game">
                      <span className={`chip-swatch series-bg-${slots.get(id)}`} aria-hidden="true" />
                      <GameIcon src={g?.icon} size={28} />
                      <span className="table-game-text">
                        <span className="table-game-name">{g?.name ?? "Loading…"}</span>
                        {isMain && <span className="muted small">Main game</span>}
                      </span>
                    </span>
                  </td>
                  <td className="num">{formatNumber(g?.playing)}</td>
                  <td className="num">{isMain ? "—" : playersVsMain(g?.playing, main?.playing)}</td>
                  <td className="num">{formatNumber(summary?.peak)}</td>
                  <td className="num">{summary?.visitsGained == null ? "—" : `+${formatCompact(summary.visitsGained)}`}</td>
                  <td className="num">{formatPercent(rating)}</td>
                  <td className="num">{isMain ? "—" : ratingVsMain(rating, mainRating)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Shown when there's no main game yet: pick one to start. */
function PickFirstGame({ onPick }) {
  return (
    <section className="compare-start">
      <title>Compare · Roblox Game Tracker</title>
      <h1>Compare games</h1>
      <p className="muted">Pick a main game to start. You can then add up to {MAX_OTHERS} others to compare it with.</p>
      <div className="compare-start-search">
        <SearchBox id="compare-start" onSelect={onPick} shortcut={false}
                   placeholder="Search for your main game…" label="Pick a main game" />
      </div>
      <p className="muted small">Tip: press &ldquo;Set as main&rdquo; on any game&apos;s page and it&apos;ll be picked here automatically.</p>
    </section>
  );
}
