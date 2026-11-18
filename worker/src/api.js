// The web API the site talks to. Every reply is JSON.
//
//   GET /api/search?q=blox             find any Roblox game by name
//   GET /api/games/123                 one game's details and live numbers
//   GET /api/games/123/history?range=7d   chart data + update markers
//   GET /api/leaderboards              the home page lists (top 20 of each)
//   GET /api/charts                    every tracked game, for the full chart tables
//   GET /api/status                    is the tracker healthy?

import { OPTIONAL, VISITOR, fetchGameStats, fetchIcons, searchGames } from "./roblox.js";
import { MIN_READINGS_FOR_A_DAY, nowSeconds } from "./db.js";

const DAY = 86400;
const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 }; // plus "ytd" and "all"
const HOURLY_RANGES = new Set(["24h", "7d", "30d"]); // longer ranges use one point per day

// Sent with every reply.
const HEADERS = {
  // Lets web pages on any site read our replies (browsers block it otherwise).
  // Safe here: the data is public and the API only allows reading.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Standard protective headers: never guess a reply's type, never run or
  // frame anything from it, and don't tell other sites where visitors came from.
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
};

// Limits on adding games through search, so nobody can fill the tracker with junk.
const MIN_VISITS_TO_TRACK = 1000;       // ...or at least one player online right now
const MAX_SEARCH_ADDS_PER_DAY = 200;    // across all visitors

export async function handleApi(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { headers: HEADERS });
  if (request.method !== "GET") return error(405, "Only GET requests are supported");

  // A generous per-visitor limit (see wrangler.jsonc). Normal browsing uses a
  // small fraction of it; it's there to stop scripts hammering the API, which
  // would use up the free plan's daily requests and could get us blocked by Roblox.
  const visitor = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(env.API_LIMITER, visitor))) {
    return error(429, "Too many requests. Please slow down and try again in a minute.", { "Retry-After": "60" });
  }

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
    response = await route(new URL(request.url), env, visitor);
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

async function route(url, env, visitor) {
  const path = url.pathname.replace(/\/+$/, ""); // ignore a trailing slash
  if (path === "/api/search") return search(url.searchParams.get("q"), env);
  if (path === "/api/leaderboards") return leaderboards(env);
  if (path === "/api/charts") return charts(env);
  if (path === "/api/status") return status(env);

  let match = path.match(/^\/api\/games\/(\d{1,15})$/);
  if (match) return game(Number(match[1]), env, visitor);

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
  const trace = [];
  try {
    results = (await searchGames(query, { policy: { ...VISITOR, timeoutMs: 4_000 }, trace })).slice(0, 20);
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
    fetchIcons(ids, { policy: OPTIONAL, trace }).catch(() => new Map()), // icons are nice-to-have
    trackedSinceFor(env, ids),
  ]);
  return withTiming(json({
    query,
    source,
    results: results.map((game) => ({
      ...game,
      icon: icons.get(game.universeId) ?? null,
      trackedSince: trackedSince.get(game.universeId) ?? null,
    })),
  }, 300), trace);
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

async function game(universeId, env, visitor) {
  const trace = []; // how long each Roblox request took (sent in the Server-Timing header)
  const [live, icons, ranks] = await Promise.all([
    // null = Roblox didn't answer properly, even after a quick second try
    fetchGameStats([universeId], { policy: VISITOR, optionalVotes: true, trace })
      .catch((err) => { console.error("Roblox game lookup failed:", err.message); return null; }),
    fetchIcons([universeId], { policy: OPTIONAL, trace }).catch(() => new Map()), // nice-to-have
    env.DB.prepare("SELECT value FROM meta WHERE key = 'game_ranks'").first("value"),
  ]);

  // "#14 most played of 1,203" and the 24h change, from the hourly charts job.
  const saved = ranks ? JSON.parse(ranks) : null;
  const [rank, change24h] = saved?.ranks[universeId] ?? [null, null];
  const extras = { rank: rank && { position: rank, of: saved.total }, change24h };

  const stats = live?.[0];
  // Anything we're missing from Roblox (everything, or just the likes or the
  // icon) comes from our latest hourly reading, if we track this game.
  const last = !stats || stats.votesUnavailable || !icons.has(universeId)
    ? await lastReading(env, universeId)
    : null;

  if (!stats) {
    // Roblox failed, or sent nothing usable for a game we know exists. Show our
    // latest reading, marked "stale" with when it was taken, rather than an
    // error or "no such game". Never cached, so the next visit tries Roblox again.
    // `unavailable`: Roblox did answer, but listed the game as unavailable (it's
    // private, closed for an update or under review), so the page can say that
    // instead of "Roblox isn't answering".
    if (last) {
      return withTiming(json({
        ...last, icon: icons.get(universeId) ?? last.icon, ...extras, stale: true, unavailable: live !== null,
      }, 0), trace);
    }
    if (live === null) throw new Error("Roblox is unavailable and there's no saved reading for this game");
    return withTiming(error(404, "There's no Roblox game with that ID"), trace);
  }

  if (stats.votesUnavailable) {
    stats.likes = last?.likes ?? null;
    stats.dislikes = last?.dislikes ?? null;
    delete stats.votesUnavailable;
  }
  const tracking = await startTracking(env, stats, visitor);
  return withTiming(json({
    ...stats,
    icon: icons.get(universeId) ?? last?.icon ?? null,
    ...tracking,
    ...extras,
    stale: false,
    fetchedAt: nowSeconds(),
  }, 60), trace);
}

/**
 * Adds a Server-Timing header saying how long each Roblox request took and how
 * many tries it needed, e.g. "details;dur=312;desc=\"1 try\"". Browsers show it
 * in their developer tools, which makes slow or failing requests easy to spot.
 */
function withTiming(response, trace) {
  if (trace.length) {
    response.headers.set("Server-Timing", trace.map((t) =>
      `${t.label};dur=${t.ms};desc="${t.tries} ${t.tries === 1 ? "try" : "tries"}${t.problem ? `, ${t.problem.replace(/"/g, "'")}` : ""}"`,
    ).join(", "));
  }
  return response;
}

/**
 * A tracked game's details and newest hourly reading, in the same shape as
 * fetchGameStats, or null if we aren't tracking it. Used when Roblox is down.
 */
async function lastReading(env, universeId) {
  const row = await env.DB.prepare(`
    SELECT g.root_place_id, g.name, g.creator_name, g.genre, g.icon, g.created_at,
           g.last_updated, g.tracked_since, s.hour, s.playing, s.visits, s.favorites, s.likes, s.dislikes
      FROM games g
      JOIN snapshots s ON s.universe_id = g.universe_id
     WHERE g.universe_id = ?1 AND g.active = 1 AND g.name IS NOT NULL
     ORDER BY s.hour DESC
     LIMIT 1`,
  ).bind(universeId).first();
  if (!row) return null;
  return {
    universeId,
    rootPlaceId: row.root_place_id,
    name: row.name,
    creatorName: row.creator_name,
    description: "",
    genre: row.genre,
    maxPlayers: null,
    createdAt: row.created_at,
    lastUpdated: row.last_updated,
    playing: row.playing,
    visits: row.visits,
    favorites: row.favorites,
    likes: row.likes,
    dislikes: row.dislikes,
    icon: row.icon,
    trackedSince: row.tracked_since,
    isTracking: true,
    notTrackedReason: null,
    fetchedAt: row.hour, // when this reading was taken, so the page can say "Updated 25 minutes ago"
  };
}

/**
 * Anyone looking at a game means it's probably worth recording, so start
 * tracking it - unless one of the safeguards says no.
 * Returns { trackedSince, isTracking, notTrackedReason }, where the reason is:
 *   "quiet" - no players and under 1,000 visits (not worth a tracking place yet)
 *   "busy"  - too many games added recently (by this visitor, or by everyone today)
 *   "full"  - all tracking places are in use
 */
async function startTracking(env, stats, visitor) {
  const existing = await env.DB.prepare(
    "SELECT tracked_since, active FROM games WHERE universe_id = ?1",
  ).bind(stats.universeId).first();
  if (existing?.active) return { trackedSince: existing.tracked_since, isTracking: true, notTrackedReason: null };
  const notTracked = (reason) => ({ trackedSince: existing?.tracked_since ?? null, isTracking: false, notTrackedReason: reason });

  // Safeguard 1: only games with some life in them. Stops a script filling
  // the tracker with thousands of empty games.
  if (stats.playing < 1 && stats.visits < MIN_VISITS_TO_TRACK) return notTracked("quiet");

  // Safeguard 2: one visitor can only add a few games a minute...
  if (!(await allowed(env.TRACK_LIMITER, visitor))) return notTracked("busy");

  // ...and everyone together only so many a day.
  const [activeCount, addedToday] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE active = 1").first("n"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE source = 'search' AND tracked_since > ?1")
      .bind(nowSeconds() - 86_400).first("n"),
  ]);
  if (addedToday >= MAX_SEARCH_ADDS_PER_DAY) return notTracked("busy");
  if (activeCount >= Number(env.MAX_TRACKED_GAMES)) return notTracked("full");

  if (existing) { // paused earlier for having no players: switch it back on
    await env.DB.prepare("UPDATE games SET active = 1 WHERE universe_id = ?1")
      .bind(stats.universeId).run();
    return { trackedSince: existing.tracked_since, isTracking: true, notTrackedReason: null };
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
  return { trackedSince: now, isTracking: true, notTrackedReason: null };
}

// ---- GET /api/games/:id/history?range= ----------------------------------------

async function history(universeId, range, env) {
  const start = rangeStart(range);
  if (start === null) return error(400, "range must be one of: 24h, 7d, 30d, 90d, 1y, ytd, all");

  const resolution = HOURLY_RANGES.has(range) ? "hour" : "day";
  const [points, events] = await env.DB.batch([
    resolution === "hour"
      ? env.DB.prepare(HOURLY_POINTS).bind(universeId, start)
      : env.DB.prepare(DAILY_POINTS).bind(universeId, start, Math.floor(nowSeconds() / DAY) * DAY),
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
// Like the nightly job, a past day with too few readings is left out; today is
// always shown (?3 = the start of today), marked "so far" on the site.
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
           GROUP BY day
          HAVING COUNT(*) >= ${MIN_READINGS_FOR_A_DAY} OR day >= ?3) AS agg
    JOIN snapshots AS eod ON eod.universe_id = ?1 AND eod.hour = agg.last_hour
   WHERE agg.day NOT IN (SELECT day FROM daily WHERE universe_id = ?1 AND day >= ?2)
  ORDER BY t`;

// ---- GET /api/leaderboards, /api/charts and /api/status ------------------------

async function leaderboards(env) {
  return savedJson(env, "leaderboards", { at: null, lists: {} });
}

async function charts(env) {
  return savedJson(env, "charts", { at: null, rules: {}, games: [] });
}

/**
 * Sends a result the hourly job already saved. It's sent exactly as stored:
 * no unpacking and re-packing, which matters for the charts table (hundreds
 * of KB) because the free plan only allows a few milliseconds of work per request.
 */
async function savedJson(env, key, empty) {
  const saved = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first("value");
  if (!saved) return json(empty, 60);
  return new Response(saved, {
    headers: { ...HEADERS, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
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
  return Response.json(data, { headers: { ...HEADERS, "Cache-Control": cacheControl } });
}

/** An error reply. Never cached, so a temporary problem isn't remembered. */
function error(status, message, extraHeaders = {}) {
  return Response.json({ error: message }, {
    status,
    headers: { ...HEADERS, "Cache-Control": "no-store", ...extraHeaders },
  });
}

/**
 * Asks one of Cloudflare's rate limiters whether this visitor may continue.
 * If the limiter isn't available (e.g. an older local setup), let the request
 * through rather than break the site - the database safeguards still apply.
 */
async function allowed(limiter, key) {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    console.error("Rate limiter unavailable:", err.message);
    return true;
  }
}
