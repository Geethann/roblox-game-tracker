// Background jobs: the nightly tidy-up, and the home page lists.

import { fetchIcons } from "./roblox.js";
import { nowSeconds, setMeta } from "./db.js";

const DAY = 86400;
const KEEP_HOURLY_DAYS = 90;   // hourly rows older than this are deleted (daily rows stay)
const DEAD_AFTER_DAYS = 30;    // stop recording games with no players for this long
const ROLLUP_DAYS = 7;         // summarise the last 7 days each night, so missed nights catch up
const LIST_SIZE = 20;

/**
 * Runs once a day, just after midnight UTC.
 * All three steps are one batch, so they succeed or fail together.
 */
export async function dailyMaintenance(env, now) {
  const today = Math.floor(now.getTime() / 1000 / DAY) * DAY; // midnight UTC today

  const [rollup, cleanup, prune] = await env.DB.batch([
    // 1. Turn each complete day's hourly rows into one daily summary row.
    //    "OR IGNORE" skips days already summarised.
    //    "universe_id IN (SELECT ... FROM games)" lets the database jump straight
    //    to each game's rows instead of reading the whole table.
    env.DB.prepare(`
      INSERT OR IGNORE INTO daily
        (universe_id, day, avg_playing, peak_playing, visits, favorites, likes, dislikes)
      SELECT agg.universe_id, agg.day, agg.avg_playing, agg.peak_playing,
             eod.visits, eod.favorites, eod.likes, eod.dislikes
        FROM (SELECT universe_id,
                     hour / ${DAY} * ${DAY}              AS day,
                     CAST(ROUND(AVG(playing)) AS INTEGER) AS avg_playing,
                     MAX(playing)                         AS peak_playing,
                     MAX(hour)                            AS last_hour
                FROM snapshots
               WHERE universe_id IN (SELECT universe_id FROM games)
                 AND hour >= ?1 AND hour < ?2
               GROUP BY universe_id, day) AS agg
        JOIN snapshots AS eod                            -- "end of day": the day's last row
          ON eod.universe_id = agg.universe_id AND eod.hour = agg.last_hour`,
    ).bind(today - ROLLUP_DAYS * DAY, today),

    // 2. Delete hourly rows older than 90 days. Their daily summaries remain.
    env.DB.prepare(`
      DELETE FROM snapshots
       WHERE universe_id IN (SELECT universe_id FROM games) AND hour < ?1`,
    ).bind(today - KEEP_HOURLY_DAYS * DAY),

    // 3. Pause games nobody has played for 30 days. Their history is kept,
    //    and they're switched back on if someone looks them up.
    env.DB.prepare(`
      UPDATE games SET active = 0
       WHERE active = 1 AND tracked_since < ?1
         AND NOT EXISTS (SELECT 1 FROM daily
                          WHERE daily.universe_id = games.universe_id
                            AND day >= ?1 AND peak_playing > 0)`,
    ).bind(today - DEAD_AFTER_DAYS * DAY),
  ]);

  const summary = {
    at: nowSeconds(),
    daysSummarised: rollup.meta.changes,
    hourlyRowsDeleted: cleanup.meta.changes,
    gamesPaused: prune.meta.changes,
  };
  await setMeta(env, "last_maintenance", summary).run();
  console.log("Daily maintenance:", JSON.stringify(summary));
}

/**
 * Runs hourly. Works out the home page lists once and saves them, so the
 * home page loads with a single tiny database read instead of crunching
 * every game for every visitor.
 */
export async function updateLeaderboards(env) {
  // Each active game's latest row, plus its row from exactly 24 hours before
  // (same time of day, so daily ups and downs don't skew the comparison).
  const { results } = await env.DB.prepare(`
    SELECT g.universe_id, g.name, g.creator_name, g.last_updated,
           cur.hour, cur.playing, cur.visits,
           ago.playing AS playing_24h_ago, ago.visits AS visits_24h_ago
      FROM games g
      JOIN snapshots cur
        ON cur.universe_id = g.universe_id
       AND cur.hour = (SELECT MAX(hour) FROM snapshots WHERE universe_id = g.universe_id)
      LEFT JOIN snapshots ago
        ON ago.universe_id = g.universe_id AND ago.hour = cur.hour - ${DAY}
     WHERE g.active = 1 AND g.name IS NOT NULL`,
  ).all();

  // Ignore games whose newest row is old (e.g. deleted from Roblox).
  const fresh = results.filter((row) => row.hour >= nowSeconds() - 2 * 3600);

  // `value` is the number that list is ranked by (players, visits gained, ...).
  const item = (row, value) => ({
    universeId: row.universe_id,
    name: row.name,
    creatorName: row.creator_name,
    playing: row.playing,
    lastUpdated: row.last_updated,
    value,
  });
  const top = (rows, score) => rows
    .map((row) => ({ row, value: score(row) }))
    .filter((entry) => entry.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, LIST_SIZE)
    .map((entry) => item(entry.row, entry.value));

  const lists = {
    // Most players online right now.
    mostPlayed: top(fresh, (row) => row.playing),
    // Most new visits in the last 24 hours.
    mostVisits24h: top(fresh, (row) =>
      row.visits_24h_ago === null ? null : row.visits - row.visits_24h_ago),
    // Biggest % rise in players vs. this time yesterday. Games under 100
    // players are skipped: going from 2 to 10 players isn't a real trend.
    trending: top(fresh, (row) =>
      row.playing_24h_ago >= 100 ? (row.playing - row.playing_24h_ago) / row.playing_24h_ago : null),
    // Most recently updated by their developers.
    recentlyUpdated: top(fresh, (row) => row.last_updated),
  };

  // Add icons in one request (every list's games together, without duplicates).
  const ids = [...new Set(Object.values(lists).flat().map((game) => game.universeId))];
  const icons = await fetchIcons(ids).catch(() => new Map()); // icons are nice-to-have
  for (const game of Object.values(lists).flat()) game.icon = icons.get(game.universeId) ?? null;

  await setMeta(env, "leaderboards", { at: nowSeconds(), lists }).run();
  console.log(`Leaderboards updated from ${fresh.length} games`);
}
