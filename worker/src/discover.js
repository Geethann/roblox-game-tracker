// Finds new games to track from Roblox's front-page lists.

import { fetchFrontPageGames } from "./roblox.js";
import { nowSeconds, setMeta } from "./db.js";

export async function discoverGames(env) {
  const maxGames = Number(env.MAX_TRACKED_GAMES);

  // 1. Everything on the front page right now, without duplicates
  //    (the same game often appears in several lists).
  const found = [...new Map(
    (await fetchFrontPageGames()).map((game) => [game.universeId, game]),
  ).values()];

  // 2. How many games we're recording, and which of these we already have.
  //    Paused games don't count towards the limit.
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE active = 1").first("n");
  const { results: existing } = await env.DB.prepare(
    "SELECT universe_id FROM games WHERE universe_id IN (SELECT value FROM json_each(?1))",
  ).bind(JSON.stringify(found.map((game) => game.universeId))).all();
  const alreadyTracked = new Set(existing.map((row) => row.universe_id));

  // 3. Add the new ones, without going over the limit.
  const room = Math.max(0, maxGames - total);
  const newGames = found.filter((game) => !alreadyTracked.has(game.universeId)).slice(0, room);
  const now = nowSeconds();

  const statements = newGames.map((game) => env.DB.prepare(
    `INSERT OR IGNORE INTO games (universe_id, root_place_id, tracked_since, source)
     VALUES (?1, ?2, ?3, 'discovered')`,
  ).bind(game.universeId, game.rootPlaceId, now));
  statements.push(setMeta(env, "last_discover", { at: now, found: found.length, added: newGames.length }));
  await env.DB.batch(statements);

  console.log(`Discovery: ${found.length} on the front page, ${newGames.length} new`);
}
