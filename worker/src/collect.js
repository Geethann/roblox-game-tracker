// Records this hour's numbers for one "slice" of the tracked games.

import { fetchGameStats, fetchIcons } from "./roblox.js";
import { nowSeconds, setMeta } from "./db.js";

/**
 * Games are split into 12 slices by their ID. One slice is collected every
 * 5 minutes, so every game is collected once an hour while each run stays
 * well inside Cloudflare's free-plan limits.
 */
export const SLICES = 12;

export async function collectSlice(env, slice, now) {
  const hour = Math.floor(now.getTime() / 3_600_000) * 3600; // start of this hour
  const seenAt = nowSeconds();
  const collected = await slicesCollected(env, hour);

  // 1. Which games are in this slice, and what did we last know about them?
  const { results: games } = await env.DB.prepare(
    `SELECT universe_id, name, last_updated, created_at, genre, icon
       FROM games
      WHERE active = 1 AND universe_id % ${SLICES} = ?1`,
  ).bind(slice).all();

  // 2. Ask Roblox for their current numbers and icons, at the same time.
  //    Icons and likes/dislikes are nice-to-have: if Roblox refuses those, the
  //    old icons are kept and this hour's likes are left blank, but the
  //    players/visits/favourites reading is still saved.
  const ids = games.map((g) => g.universe_id);
  const [stats, icons] = games.length
    ? await Promise.all([fetchGameStats(ids, { optionalVotes: true }), fetchIcons(ids).catch(() => new Map())])
    : [[], new Map()];
  const before = new Map(games.map((g) => [g.universe_id, g]));

  // 3. Build every database change, then save them all in one go.
  const statements = [];
  for (const game of stats) {
    const old = before.get(game.universeId);
    if (!old) continue;
    const icon = icons.get(game.universeId) ?? old.icon;

    // This hour's numbers. "OR IGNORE": if this hour is already saved, keep it.
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO snapshots (universe_id, hour, playing, visits, favorites, likes, dislikes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(game.universeId, hour, game.playing, game.visits, game.favorites, game.likes, game.dislikes));

    // The developer published an update we haven't recorded yet.
    if (game.lastUpdated && game.lastUpdated !== old.last_updated) {
      statements.push(env.DB.prepare(
        "INSERT OR IGNORE INTO events (universe_id, at, kind) VALUES (?1, ?2, 'update')",
      ).bind(game.universeId, game.lastUpdated));
    }

    // The title changed (skipped on a game's very first collection).
    if (old.name && game.name !== old.name) {
      statements.push(env.DB.prepare(
        "INSERT OR IGNORE INTO events (universe_id, at, kind, detail) VALUES (?1, ?2, 'rename', ?3)",
      ).bind(game.universeId, seenAt, game.name));
    }

    // Keep the game's own row up to date, but only write when something changed:
    // database writes are what the free plan limits most.
    const changed = game.name !== old.name
      || game.lastUpdated !== old.last_updated
      || game.genre !== old.genre
      || icon !== old.icon
      || old.created_at === null;
    if (changed) {
      statements.push(env.DB.prepare(
        `UPDATE games SET name = ?2, root_place_id = ?3, creator_name = ?4,
                          created_at = ?5, last_updated = ?6, genre = ?7, icon = ?8
          WHERE universe_id = ?1`,
      ).bind(game.universeId, game.name, game.rootPlaceId, game.creatorName,
             game.createdAt, game.lastUpdated, game.genre, icon));
    }
  }

  statements.push(setMeta(env, "last_collect", { at: seenAt, slice, games: stats.length }));
  statements.push(setMeta(env, "collected", { hour, slices: [...new Set([...collected, slice])] }));
  await env.DB.batch(statements); // all-or-nothing: either everything saves or nothing does
  console.log(`Slice ${slice}: saved ${stats.length} of ${games.length} games`);
}

/** Which slices have already been saved this hour (so a missed one can be retried). */
export async function slicesCollected(env, hour) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'collected'").first();
  const record = row ? JSON.parse(row.value) : null;
  return record?.hour === hour ? record.slices : [];
}
