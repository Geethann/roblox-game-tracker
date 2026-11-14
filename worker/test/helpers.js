// Shared tools for the backend tests: a pretend Roblox, and quick ways to put
// games and readings into the test database.
import { env } from "cloudflare:workers";
import { vi } from "vitest";

export const HOUR = 3600;
export const DAY = 86400;

/** The start of the current hour / day, in unix seconds. */
export const thisHour = () => Math.floor(Date.now() / 1000 / HOUR) * HOUR;
export const today = () => Math.floor(Date.now() / 1000 / DAY) * DAY;

/** Empties every table, so each test starts from a blank database. */
export async function resetDatabase() {
  await env.DB.batch(["games", "snapshots", "events", "daily", "meta"]
    .map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/** Adds a tracked game. Anything in `fields` replaces the defaults. */
export async function addGame(universeId, fields = {}) {
  const row = {
    universe_id: universeId,
    root_place_id: universeId * 10,
    name: `Game ${universeId}`,
    creator_name: "Test Creator",
    genre: "Action",
    icon: null,
    created_at: 1_700_000_000,
    last_updated: 1_790_000_000,
    tracked_since: 1_790_000_000,
    source: "discovered",
    active: 1,
    ...fields,
  };
  const columns = Object.keys(row);
  await env.DB.prepare(
    `INSERT INTO games (${columns.join(", ")}) VALUES (${columns.map((_, i) => `?${i + 1}`).join(", ")})`,
  ).bind(...Object.values(row)).run();
}

/** Adds one hourly reading for a game. */
export async function addReading(universeId, hour, numbers = {}) {
  const { playing = 10, visits = 5000, favorites = 50, likes = 90, dislikes = 10 } = numbers;
  await env.DB.prepare("INSERT INTO snapshots VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(universeId, hour, playing, visits, favorites, likes, dislikes).run();
}

/** Saves a note in the meta table (as the backend's jobs do). */
export async function setMeta(key, value) {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)")
    .bind(key, JSON.stringify(value)).run();
}

/** Reads a note from the meta table, or null. */
export async function getMeta(key) {
  const value = await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first("value");
  return value === null ? null : JSON.parse(value);
}

/** Runs a query and returns all its rows. */
export async function rows(sql, ...params) {
  return (await env.DB.prepare(sql).bind(...params).all()).results;
}

/**
 * Replaces Roblox with a pretend version for the current test, so tests never
 * depend on the real Roblox (or the internet). Returns the list of addresses
 * the code asked for, so tests can check what was requested.
 *
 *   games   { universeId: { name, playing, visits, updated, ... } } - what Roblox "knows"
 *   sorts   the front-page lists, in Roblox's format
 *   search  search results, in Roblox's format
 *   down    parts of Roblox that are broken, e.g. ["thumbnails"] or ["search"]
 *   iconVersion  changes every icon link, to pretend the icons were updated
 */
export function fakeRoblox({ games = {}, sorts = [], search = [], down = [], iconVersion = "v1" } = {}) {
  const requested = [];
  vi.stubGlobal("fetch", async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    requested.push(url.toString());
    const ids = (url.searchParams.get("universeIds") ?? "").split(",").filter(Boolean).map(Number);
    const known = ids.filter((id) => games[id]);

    // A broken service answers "400 Bad Request", which the code doesn't retry.
    const part = url.hostname.startsWith("thumbnails") ? "thumbnails"
      : url.pathname.includes("omni-search") ? "search"
      : url.pathname.includes("explore-api") ? "sorts" : "games";
    if (down.includes(part)) return new Response("Service unavailable", { status: 400 });

    if (url.hostname === "games.roblox.com" && url.pathname === "/v1/games") {
      return Response.json({ data: known.map((id) => robloxGame(id, games[id])) });
    }
    if (url.hostname === "games.roblox.com" && url.pathname === "/v1/games/votes") {
      return Response.json({ data: known.map((id) => ({
        id, upVotes: games[id].likes ?? 90, downVotes: games[id].dislikes ?? 10,
      })) });
    }
    if (part === "thumbnails") {
      return Response.json({ data: ids.map((id) => ({
        targetId: id, state: "Completed", imageUrl: `https://tr.rbxcdn.com/${iconVersion}/${id}`,
      })) });
    }
    if (part === "sorts") return Response.json({ sorts });
    if (part === "search") return Response.json({ searchResults: [{ contents: search }] });
    throw new Error(`The test didn't expect a request to ${url}`);
  });
  return requested;
}

/** One game in the format Roblox's games API sends. */
function robloxGame(id, game) {
  return {
    id,
    rootPlaceId: id * 10,
    name: game.name ?? `Game ${id}`,
    creator: { name: game.creator ?? "Test Creator" },
    description: "",
    genre: "All",
    genre_l1: game.genre ?? "Action",
    maxPlayers: 20,
    created: "2023-11-14T22:13:20Z",
    updated: game.updated ?? "2026-09-21T14:13:20Z", // 1,790,000,000 in unix seconds
    playing: game.playing ?? 10,
    visits: game.visits ?? 5000,
    favoritedCount: game.favorites ?? 50,
  };
}
