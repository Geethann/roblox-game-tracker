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


// The rules for the lists, in one place. They're also sent to the site with
// the charts data, so the site's "View all" pages always match the home page.
export const CHART_RULES = {
  risingMinPlayers: 100,   // "Rising" ignores games under 100 players yesterday: 2 -> 10 isn't a trend
  topRatedMinVotes: 1000,  // "Top rated" needs enough votes for the rating to mean something...
  topRatedMinPlayers: 100, // ...and enough players to still be relevant
};

/**
 * Runs hourly. Builds two things and saves them, so visitors get a ready-made
 * answer with one tiny database read instead of crunching every game each time:
 *   "charts"       - one row per tracked game: the full tables on the charts pages
 *   "leaderboards" - the top 20 of each list, for the home page
 */
export async function updateCharts(env) {
  // Each active game's latest row, plus its row from exactly 24 hours before
  // (same time of day, so daily ups and downs don't skew the comparison).
  const [{ results }, savedLists] = await Promise.all([
    env.DB.prepare(`
      SELECT g.universe_id, g.name, g.creator_name, g.genre, g.last_updated, g.tracked_since,
             cur.hour, cur.playing, cur.visits, cur.favorites, cur.likes, cur.dislikes,
             ago.playing AS playing_24h_ago, ago.visits AS visits_24h_ago
        FROM games g
        JOIN snapshots cur
          ON cur.universe_id = g.universe_id
         AND cur.hour = (SELECT MAX(hour) FROM snapshots WHERE universe_id = g.universe_id)
        LEFT JOIN snapshots ago
          ON ago.universe_id = g.universe_id AND ago.hour = cur.hour - ${DAY}
       WHERE g.active = 1 AND g.name IS NOT NULL`,
    ).all(),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'roblox_lists'").first("value"),
  ]);

  // Roblox's own Trending list, as positions: universeId -> 1, 2, 3...
  const trendingIds = savedLists ? JSON.parse(savedLists).lists["top-trending"]?.ids ?? [] : [];
  const trendingRank = new Map(trendingIds.map((id, i) => [id, i + 1]));

  // Ignore games whose newest row is old (e.g. deleted from Roblox).
  const fresh = results.filter((row) => row.hour >= nowSeconds() - 2 * 3600);
  const icons = await fetchIcons(fresh.map((row) => row.universe_id)).catch(() => new Map());

  const games = fresh.map((row) => {
    const votes = (row.likes ?? 0) + (row.dislikes ?? 0);
    return {
      universeId: row.universe_id,
      name: row.name,
      creatorName: row.creator_name,
      genre: row.genre,
      icon: icons.get(row.universe_id) ?? null,
      playing: row.playing,
      playing24hAgo: row.playing_24h_ago,
      change24h: row.playing_24h_ago > 0 ? (row.playing - row.playing_24h_ago) / row.playing_24h_ago : null,
      visits: row.visits,
      visits24h: row.visits_24h_ago == null ? null : row.visits - row.visits_24h_ago,
      favorites: row.favorites,
      rating: votes > 0 ? row.likes / votes : null,
      votes,
      lastUpdated: row.last_updated,
      trackedSince: row.tracked_since,
      robloxTrendingRank: trendingRank.get(row.universe_id) ?? null,
    };
  });

  // The home page lists: the top 20 of each, using the same rules as the charts pages.
  // `value` is the number that list is ranked by.
  const top = (score, ascending = false) => games
    .map((game) => ({ game, value: score(game) }))
    .filter((entry) => entry.value != null)
    .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
    .slice(0, LIST_SIZE)
    .map(({ game, value }) => ({
      universeId: game.universeId, name: game.name, creatorName: game.creatorName,
      icon: game.icon, playing: game.playing, value,
    }));

  const lists = {
    mostPlayed: top((g) => g.playing),
    trendingOnRoblox: top((g) => g.robloxTrendingRank, true), // Roblox's order: 1 first
    rising: top((g) => (g.playing24hAgo >= CHART_RULES.risingMinPlayers ? g.change24h : null)),
    mostVisits24h: top((g) => g.visits24h),
    topRated: top((g) => (g.votes >= CHART_RULES.topRatedMinVotes
      && g.playing >= CHART_RULES.topRatedMinPlayers ? g.rating : null)),
    recentlyUpdated: top((g) => g.lastUpdated),
  };

  const at = nowSeconds();
  await env.DB.batch([
    setMeta(env, "charts", { at, rules: CHART_RULES, games }),
    setMeta(env, "leaderboards", { at, lists }),
  ]);
  console.log(`Charts updated: ${games.length} games`);
}
