// Roblox Game Tracker backend: the starting point Cloudflare runs.
//
//   scheduled()  runs every 5 minutes (the schedule is in wrangler.jsonc)
//   fetch()      answers web requests: the API the site uses (see api.js)

import { handleApi } from "./api.js";
import { collectSlice, SLICES } from "./collect.js";
import { discoverGames } from "./discover.js";
import { dailyMaintenance, updateLeaderboards } from "./maintenance.js";

export default {
  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    const slice = Math.floor(now.getUTCMinutes() / 5) % SLICES; // :00 -> 0, :05 -> 1 ... :55 -> 11

    await collectSlice(env, slice, now);

    // Hourly at :00 - refresh the home page lists, then look for new games.
    // Discovery goes last: if Roblox's front-page lists ever break, everything
    // else has already been saved. It also runs whenever no games are tracked
    // yet, so a brand-new database fills itself straight away.
    if (slice === 0) await updateLeaderboards(env);
    const isEmpty = (await env.DB.prepare("SELECT 1 FROM games LIMIT 1").first()) === null;
    if (slice === 0 || isEmpty) await discoverGames(env);

    // Daily at 00:05 UTC - summarise yesterday and tidy up.
    if (slice === 1 && now.getUTCHours() === 0) await dailyMaintenance(env, now);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    // Visiting the bare address shows the health check.
    if (url.pathname === "/") return Response.redirect(new URL("/api/status", url), 302);
    return new Response("Not found", { status: 404 });
  },
};
