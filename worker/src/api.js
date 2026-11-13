// The web API the site talks to. Every reply is JSON.
//
//   GET /api/search?q=blox             find any Roblox game by name
//   GET /api/games/123                 one game's details and live numbers
//   GET /api/games/123/history?range=7d   chart data + update markers
//   GET /api/leaderboards              the home page lists
//   GET /api/status                    is the tracker healthy?

import { fetchGameStats, fetchIcons, searchGames } from "./roblox.js";
import { nowSeconds } from "./db.js";

const DAY = 86400;
const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 }; // plus "ytd" and "all"
const HOURLY_RANGES = new Set(["24h", "7d", "30d"]); // longer ranges use one point per day

// Lets web pages on any site read our replies (browsers block it otherwise).
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export async function handleApi(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "GET") return error(405, "Only GET requests are supported");

  // If an identical request was answered recently, reuse that answer.
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set("X-Cache", "HIT");
    return hit;
  }

  let response;
  try {
    response = await route(new URL(request.url), env);
  } catch (err) {
    console.error(err); // full details go to our logs, not to visitors
    return error(500, "Something went wrong on our side. Please try again in a minute.");
  }
  // Save successful answers for next time, without making this visitor wait
  // (unless the answer says it mustn't be kept).
  const keepable = !response.headers.get("Cache-Control")?.includes("no-store");
  if (response.ok && keepable) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

async function route(url, env) {
  const path = url.pathname.replace(/\/+$/, ""); // ignore a trailing slash
  if (path === "/api/search") return search(url.searchParams.get("q"), env);
  if (path === "/api/leaderboards") return leaderboards(env);
  if (path === "/api/status") return status(env);

  let match = path.match(/^\/api\/games\/(\d{1,15})$/);
  if (match) return game(Number(match[1]), env);

  match = path.match(/^\/api\/games\/(\d{1,15})\/history$/);
  if (match) return history(Number(match[1]), url.searchParams.get("range") ?? "7d", env);

  return error(404, "Not found");
}

// ---- GET /api/search?q= ------------------------------------------------------

async function search(rawQuery, env) {
  const query = (rawQuery ?? "").trim();
  if (query.length < 2 || query.length > 50) return error(400, "Search must be 2-50 characters");

  let results;
  let source = "roblox";
  try {
    results = (await searchGames(query)).slice(0, 20);
  } catch (err) {
    // Roblox's search isn't officially supported, so if it fails, fall back
    // to searching the games we already track (no live numbers, but useful).
    console.error("Roblox search failed:", err.message);
    source = "tracked";
    ({ results } = await env.DB.prepare(`
      SELECT universe_id AS universeId, root_place_id AS rootPlaceId,
             name, creator_name AS creatorName
        FROM games WHERE name LIKE ?1 LIMIT 20`,
    ).bind(`%${query}%`).all());
  }

  const ids = results.map((game) => game.universeId);
  const [icons, trackedSince] = await Promise.all([
    fetchIcons(ids).catch(() => new Map()), // icons are nice-to-have
    trackedSinceFor(env, ids),
  ]);
  return json({
    query,
    source,
    results: results.map((game) => ({
      ...game,
      icon: icons.get(game.universeId) ?? null,
      trackedSince: trackedSince.get(game.universeId) ?? null,
    })),
  }, 300);
}

/** For a list of games, when we started tracking each one (if we have). */
async function trackedSinceFor(env, ids) {
  if (ids.length === 0) return new Map();
  const { results } = await env.DB.prepare(`
    SELECT universe_id, tracked_since FROM games
     WHERE universe_id IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify(ids)).all();
  return new Map(results.map((row) => [row.universe_id, row.tracked_since]));
}

// ---- GET /api/games/:id ------------------------------------------------------

async function game(universeId, env) {
  const [[stats], icons] = await Promise.all([
    fetchGameStats([universeId]),
    fetchIcons([universeId]).catch(() => new Map()),
  ]);
  if (!stats) return error(404, "There's no Roblox game with that ID");

  const tracking = await startTracking(env, stats);
  return json({
    ...stats,
    icon: icons.get(universeId) ?? null,
    ...tracking,
    fetchedAt: nowSeconds(),
  }, 60);
}

/**
 * Anyone looking at a game means it's worth recording, so make sure it is.
 * Returns { trackedSince, isTracking } - isTracking is false only if the
 * tracker is full.
 */
async function startTracking(env, stats) {
  const existing = await env.DB.prepare(
    "SELECT tracked_since, active FROM games WHERE universe_id = ?1",
  ).bind(stats.universeId).first();
  if (existing?.active) return { trackedSince: existing.tracked_since, isTracking: true };

  const activeCount = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM games WHERE active = 1").first("n");
  if (activeCount >= Number(env.MAX_TRACKED_GAMES)) {
    return { trackedSince: existing?.tracked_since ?? null, isTracking: false };
  }

  if (existing) { // paused earlier for having no players: switch it back on
    await env.DB.prepare("UPDATE games SET active = 1 WHERE universe_id = ?1")
      .bind(stats.universeId).run();
    return { trackedSince: existing.tracked_since, isTracking: true };
  }

  // Brand new: add it, and save the numbers we just fetched as its first
  // hourly row, so its history starts now rather than at its next slice.
  const now = nowSeconds();
  const hour = Math.floor(now / 3600) * 3600;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO games (universe_id, root_place_id, name, creator_name,
                                   created_at, last_updated, tracked_since, source)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'search')`,
    ).bind(stats.universeId, stats.rootPlaceId, stats.name, stats.creatorName,
           stats.createdAt, stats.lastUpdated, now),
    env.DB.prepare(`
      INSERT OR IGNORE INTO snapshots (universe_id, hour, playing, visits, favorites, likes, dislikes)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(stats.universeId, hour, stats.playing, stats.visits, stats.favorites,
           stats.likes, stats.dislikes),
    env.DB.prepare(
      "INSERT OR IGNORE INTO events (universe_id, at, kind) VALUES (?1, ?2, 'update')",
    ).bind(stats.universeId, stats.lastUpdated),
  ]);
  return { trackedSince: now, isTracking: true };
}

// ---- GET /api/games/:id/history?range= ----------------------------------------

async function history(universeId, range, env) {
  const start = rangeStart(range);
  if (start === null) return error(400, "range must be one of: 24h, 7d, 30d, 90d, 1y, ytd, all");

  const resolution = HOURLY_RANGES.has(range) ? "hour" : "day";
  const [points, events] = await env.DB.batch([
    env.DB.prepare(resolution === "hour" ? HOURLY_POINTS : DAILY_POINTS).bind(universeId, start),
    env.DB.prepare(`
      SELECT at AS t, kind, detail FROM events
       WHERE universe_id = ?1 AND at >= ?2 ORDER BY at`,
    ).bind(universeId, start),
  ]);
  // An empty history usually means tracking only just started and the first
  // reading is about to appear, so don't let anyone keep that answer.
  const maxAge = points.results.length > 0 ? 300 : 0;
  return json({ universeId, range, resolution, points: points.results, events: events.results }, maxAge);
}

/** When a range starts, in unix seconds, or null if the range isn't valid. */
function rangeStart(range) {
  if (Object.hasOwn(RANGE_DAYS, range)) return nowSeconds() - RANGE_DAYS[range] * DAY;
  if (range === "ytd") return Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000; // 1 Jan, UTC
  if (range === "all") return 0;
  return null;
}

const HOURLY_POINTS = `
  SELECT hour AS t, playing, visits, favorites, likes, dislikes
    FROM snapshots
   WHERE universe_id = ?1 AND hour >= ?2
   ORDER BY hour`;

// Daily points: the nightly summaries, plus any days not summarised yet
// (always today, as it isn't over) worked out on the spot from hourly rows.
const DAILY_POINTS = `
  SELECT day AS t, avg_playing AS playing, peak_playing AS peak,
         visits, favorites, likes, dislikes
    FROM daily
   WHERE universe_id = ?1 AND day >= ?2
  UNION ALL
  SELECT agg.day, agg.avg_playing, agg.peak_playing,
         eod.visits, eod.favorites, eod.likes, eod.dislikes
    FROM (SELECT hour / ${DAY} * ${DAY}              AS day,
                 CAST(ROUND(AVG(playing)) AS INTEGER) AS avg_playing,
                 MAX(playing)                         AS peak_playing,
                 MAX(hour)                            AS last_hour
            FROM snapshots
           WHERE universe_id = ?1 AND hour >= ?2
           GROUP BY day) AS agg
    JOIN snapshots AS eod ON eod.universe_id = ?1 AND eod.hour = agg.last_hour
   WHERE agg.day NOT IN (SELECT day FROM daily WHERE universe_id = ?1 AND day >= ?2)
  ORDER BY t`;

// ---- GET /api/leaderboards and /api/status ------------------------------------

async function leaderboards(env) {
  const saved = await env.DB.prepare("SELECT value FROM meta WHERE key = 'leaderboards'").first("value");
  return json(saved ? JSON.parse(saved) : { at: null, lists: {} }, 300);
}

async function status(env) {
  const tracked = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM games WHERE active = 1").first("n");
  const { results } = await env.DB.prepare(
    "SELECT key, value FROM meta WHERE key LIKE 'last_%'").all();
  const notes = Object.fromEntries(results.map((row) => [row.key, JSON.parse(row.value)]));
  return json({ trackedGames: tracked, maxGames: Number(env.MAX_TRACKED_GAMES), ...notes }, 30);
}

// ---- reply helpers ------------------------------------------------------------

/** A JSON reply that browsers and Cloudflare may reuse for `maxAgeSeconds` (0 = never). */
function json(data, maxAgeSeconds) {
  const cacheControl = maxAgeSeconds > 0 ? `public, max-age=${maxAgeSeconds}` : "no-store";
  return Response.json(data, { headers: { ...CORS, "Cache-Control": cacheControl } });
}

/** An error reply. Never cached, so a temporary problem isn't remembered. */
function error(status, message) {
  return Response.json({ error: message }, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store" },
  });
}
