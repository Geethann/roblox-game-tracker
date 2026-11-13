// Roblox Game Tracker backend: the starting point Cloudflare runs.
//
//   scheduled()  runs every 5 minutes (the schedule is in wrangler.jsonc)
//   fetch()      answers web requests; for now just a status page

import { collectSlice, SLICES } from "./collect.js";
import { discoverGames } from "./discover.js";

export default {
  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    const slice = Math.floor(now.getUTCMinutes() / 5) % SLICES; // :00 -> 0, :05 -> 1 ... :55 -> 11

    await collectSlice(env, slice, now);

    // Once an hour, look for new games. This runs after collecting, so if
    // Roblox's front-page lists ever break, the hourly numbers still save.
    if (slice === 0) await discoverGames(env);
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }
    const tracked = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM games WHERE active = 1").first("n");
    const { results } = await env.DB.prepare("SELECT key, value FROM meta").all();
    const notes = Object.fromEntries(results.map((row) => [row.key, JSON.parse(row.value)]));
    return Response.json({ tracked_games: tracked, ...notes });
  },
};
