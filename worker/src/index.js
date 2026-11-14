// Roblox Game Tracker backend: the starting point Cloudflare runs.
//
//   scheduled()  runs every 5 minutes (the schedule is in wrangler.jsonc)
//   fetch()      answers web requests: the API the site uses (see api.js)

import { handleApi } from "./api.js";
import { collectSlice, slicesCollected, SLICES } from "./collect.js";
import { discoverGames } from "./discover.js";
import { dailyMaintenance, updateCharts } from "./maintenance.js";

const CHARTS_SLICE = 0;       // :00 - rebuild the charts / home page lists
const DISCOVERY_SLICE = 6;    // :30 - look for new games (kept apart from the charts job,
                              //       so each run stays well inside the free plan's CPU limit)
const MAINTENANCE_SLICE = 1;  // 00:05 UTC - nightly summaries and tidy-up

/** Collects one slice. If Roblox refuses, logs it and carries on with the other jobs. */
async function collect(env, slice, now) {
  try {
    await collectSlice(env, slice, now);
  } catch (err) {
    console.error(`Slice ${slice}: not collected (${err.message}); a later run this hour will retry`);
  }
}

export default {
  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    const slice = Math.floor(now.getUTCMinutes() / 5) % SLICES; // :00 -> 0, :05 -> 1 ... :55 -> 11

    await collect(env, slice, now);

    // Roblox sometimes refuses every try for a slice (it turns away some requests
    // from Cloudflare's shared addresses). Then that slice's games would have no
    // reading this hour, leaving a gap in their charts. So each later run this
    // hour retries one missed slice, except the runs that already do a big job.
    const isNightly = slice === MAINTENANCE_SLICE && now.getUTCHours() === 0;
    if (slice !== CHARTS_SLICE && slice !== DISCOVERY_SLICE && !isNightly) {
      const done = await slicesCollected(env, Math.floor(now.getTime() / 3_600_000) * 3600);
      const missed = Array.from({ length: slice }, (_, s) => s).find((s) => !done.includes(s));
      if (missed !== undefined) await collect(env, missed, now);
    }

    if (slice === CHARTS_SLICE) await updateCharts(env);

    // Discovery also runs whenever no games are tracked yet, so a brand-new
    // database fills itself straight away. It goes after everything else: if
    // Roblox's front-page lists ever break, the rest has already been saved.
    const isEmpty = (await env.DB.prepare("SELECT 1 FROM games LIMIT 1").first()) === null;
    if (slice === DISCOVERY_SLICE || isEmpty) await discoverGames(env);

    if (isNightly) await dailyMaintenance(env, now);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    // Visiting the bare address shows the health check.
    if (url.pathname === "/") return Response.redirect(new URL("/api/status", url), 302);
    return new Response("Not found", { status: 404 });
  },
};
