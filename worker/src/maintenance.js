// Background jobs: the nightly tidy-up, and the home page lists.

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
 * Runs hourly. Builds three things and saves them, so visitors get a ready-made
 * answer with one tiny database read instead of crunching every game each time:
 *   "charts"       - one row per tracked game: the full tables on the charts pages
 *   "leaderboards" - the top 20 of each list, for the home page
 *   "game_ranks"   - each game's rank by players, for "#14 most played" on game pages
 *
 * All the work happens inside the database: it works out the numbers, sorts the
 * lists and writes the results straight into the meta table. The Worker only
 * sends the instructions and waits, and waiting doesn't count towards the free
 * plan's 10 ms computing limit per run. (Done in JavaScript, this took ~13 ms
 * at 1,500 games.)
 */
export async function updateCharts(env) {
  const results = await env.DB.batch(chartStatements(env, nowSeconds()));
  const rowsRead = results.reduce((sum, r) => sum + (r.meta?.rows_read ?? 0), 0);
  console.log(`Charts updated (${rowsRead} rows read)`);
  return results;
}

/** The three statements the charts job runs (separate, so tests can check their cost). */
export function chartStatements(env, at) {
  const freshAfter = at - 2 * 3600;
  const rules = JSON.stringify(CHART_RULES);
  return [
    env.DB.prepare(CHARTS_SQL).bind(at, freshAfter, rules),
    env.DB.prepare(LEADERBOARDS_SQL).bind(at, freshAfter, rules),
    env.DB.prepare(RANKS_SQL).bind(at, freshAfter),
  ];
}

// Every active game's latest numbers, compared with the same hour yesterday.
// ?1 = now, ?2 = "fresh" cut-off: games whose newest row is older than 2 hours
// are left out (e.g. deleted from Roblox). Shared by the three statements below.
//
// Cost matters here: the free plan allows 5 million rows read per day, and this
// runs every hour. So each game's newest row is found by looking only at its
// last 2 hours (?2), which the (universe_id, hour) key jumps straight to: a few
// rows per game, however much history there is. (Looking through all of a
// game's history instead read ~465,000 rows an hour after two days, and grew.)
// MATERIALIZED works the numbers out once per statement, rather than once for
// every list that uses them.
const GAMES = `
  WITH trending AS MATERIALIZED (  -- Roblox's own Trending list, as positions 1, 2, 3...
                                   -- (MATERIALIZED: made into a table the database can
                                   -- index, instead of re-reading the whole list for
                                   -- every game: ~95,000 rows a statement at 930 games)
    SELECT CAST(value AS INTEGER) AS universe_id, CAST(key AS INTEGER) + 1 AS position
      FROM json_each((SELECT value FROM meta WHERE key = 'roblox_lists'),
                     '$.lists."top-trending".ids')
  ),
  newest AS MATERIALIZED (      -- each active game and the hour of its newest fresh row
    SELECT g.*, (SELECT MAX(s.hour) FROM snapshots s
                  WHERE s.universe_id = g.universe_id AND s.hour >= ?2) AS hour
      FROM games g
     WHERE g.active = 1 AND g.name IS NOT NULL
  ),
  latest AS (                   -- that row, and the one 24 hours before it
    SELECT n.universe_id, n.name, n.creator_name, n.genre, n.icon, n.last_updated, n.tracked_since,
           cur.playing, cur.visits, cur.favorites, cur.likes, cur.dislikes,
           ago.playing AS playing_24h_ago, ago.visits AS visits_24h_ago,
           COALESCE(cur.likes, 0) + COALESCE(cur.dislikes, 0) AS votes
      FROM newest n
      JOIN snapshots cur
        ON cur.universe_id = n.universe_id AND cur.hour = n.hour
      LEFT JOIN snapshots ago
        ON ago.universe_id = n.universe_id AND ago.hour = n.hour - ${DAY}
  ),
  board AS MATERIALIZED (       -- plus the worked-out numbers the lists are ranked by
    SELECT latest.*,
           CASE WHEN playing_24h_ago > 0
                THEN (playing - playing_24h_ago) * 1.0 / playing_24h_ago END AS change24h,
           visits - visits_24h_ago AS visits24h,
           CASE WHEN votes > 0 THEN COALESCE(likes, 0) * 1.0 / votes END AS rating,
           trending.position AS trending_rank
      FROM latest LEFT JOIN trending USING (universe_id)
  )`;

// Saves a value into the meta table, replacing the old one.
// ("WHERE true" is needed by SQLite's grammar when INSERT ... SELECT has ON CONFLICT.)
const saveMeta = (key, value) => `${GAMES}
  INSERT INTO meta (key, value) SELECT '${key}', ${value} WHERE true
  ON CONFLICT (key) DO UPDATE SET value = excluded.value`;

// The full charts table. ?3 = CHART_RULES, sent along so the site's "View all"
// pages always use the same rules as the home page.
const CHARTS_SQL = saveMeta("charts", `json_object(
  'at', ?1,
  'rules', json(?3),
  'games', (SELECT json_group_array(json_object(
    'universeId', universe_id, 'name', name, 'creatorName', creator_name, 'genre', genre,
    'icon', icon, 'playing', playing, 'playing24hAgo', playing_24h_ago, 'change24h', change24h,
    'visits', visits, 'visits24h', visits24h, 'favorites', favorites, 'rating', rating,
    'votes', votes, 'lastUpdated', last_updated, 'trackedSince', tracked_since,
    'robloxTrendingRank', trending_rank)) FROM board))`);

// One home page list: the top 20 games by `value`, best first, leaving out games
// where it's NULL. Ties go to the lower ID, so the order never shuffles randomly.
const top = (value, direction = "DESC") => `(
  SELECT json_group_array(json(item)) FROM (
    SELECT json_object('universeId', universe_id, 'name', name, 'creatorName', creator_name,
                       'icon', icon, 'playing', playing, 'value', v) AS item
      FROM (SELECT *, ${value} AS v FROM board)
     WHERE v IS NOT NULL
     ORDER BY v ${direction}, universe_id
     LIMIT ${LIST_SIZE}))`;

const LEADERBOARDS_SQL = saveMeta("leaderboards", `json_object(
  'at', ?1,
  'lists', json_object(
    'mostPlayed', ${top("playing")},
    'trendingOnRoblox', ${top("trending_rank", "ASC")},
    'rising', ${top(`CASE WHEN playing_24h_ago >= json_extract(?3, '$.risingMinPlayers')
                     THEN change24h END`)},
    'mostVisits24h', ${top("visits24h")},
    'topRated', ${top(`CASE WHEN votes >= json_extract(?3, '$.topRatedMinVotes')
                        AND playing >= json_extract(?3, '$.topRatedMinPlayers')
                       THEN rating END`)},
    'recentlyUpdated', ${top("last_updated")}))`);

// { id: [rank, change24h] }, ranked by players online, so a game page can look
// up "#14 most played" without reading the whole charts table.
const RANKS_SQL = saveMeta("game_ranks", `(
  SELECT json_object('at', ?1, 'total', COUNT(*),
                     'ranks', json_group_object(universe_id, json_array(position, change24h)))
    FROM (SELECT universe_id, change24h,
                 ROW_NUMBER() OVER (ORDER BY playing DESC, universe_id) AS position
            FROM board WHERE playing IS NOT NULL))`);
