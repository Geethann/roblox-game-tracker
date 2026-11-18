// The nightly job: daily summaries, deleting old hourly rows, pausing dead games.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { dailyMaintenance } from "../src/maintenance.js";
import { DAY, HOUR, addGame, addReading, getMeta, resetDatabase, rows } from "./helpers.js";

const TODAY = Date.UTC(2026, 10, 14) / 1000;   // midnight UTC
const NOW = new Date((TODAY + 5 * 60) * 1000); // 00:05, when the job runs
const YESTERDAY = TODAY - DAY;

beforeEach(resetDatabase);

async function addDaily(universeId, day, peak, avg = peak) {
  await env.DB.prepare("INSERT INTO daily VALUES (?1, ?2, ?3, ?4, 5000, 50, 90, 10)")
    .bind(universeId, day, avg, peak).run();
}

/** Hourly readings for `hours` hours of a day (all 24 by default), all with these numbers. */
async function addDay(universeId, day, numbers = {}, hours = 24) {
  for (let h = 0; h < hours; h++) await addReading(universeId, day + h * HOUR, numbers);
}

describe("the nightly job", () => {
  it("summarises each finished day: average and peak players, end-of-day totals", async () => {
    await addGame(1);
    await addDay(1, YESTERDAY, { playing: 20, visits: 100, favorites: 1, likes: 1, dislikes: 0 }, 23);
    await env.DB.prepare("UPDATE snapshots SET playing = 44 WHERE hour = ?1").bind(YESTERDAY + 6 * HOUR).run();
    await addReading(1, YESTERDAY + 23 * HOUR, { playing: 20, visits: 300, favorites: 3, likes: 3, dislikes: 2 });
    await addReading(1, TODAY, { playing: 999 }); // today isn't over, so it isn't summarised
    await dailyMaintenance(env, NOW);

    expect(await rows("SELECT * FROM daily")).toEqual([{
      universe_id: 1, day: YESTERDAY, avg_playing: 21, peak_playing: 44, // (23 × 20 + 44) ÷ 24 = 21
      visits: 300, favorites: 3, likes: 3, dislikes: 2,                  // from the day's last reading
    }]);
  });

  it("leaves out a day with too few readings (e.g. an outage), so it can't skew the daily charts", async () => {
    await addGame(1);
    await addDay(1, YESTERDAY, { playing: 50 }, 10);         // only 10 of 24 hours recorded
    await addDay(1, YESTERDAY - DAY, { playing: 60 }, 18);   // 18 is enough
    await dailyMaintenance(env, NOW);

    expect(await rows("SELECT day FROM daily")).toEqual([{ day: YESTERDAY - DAY }]);
  });

  it("catches up on missed nights, but never changes a day already summarised", async () => {
    await addGame(1);
    await addDay(1, YESTERDAY - 2 * DAY, { playing: 40 }); // 3 days ago, not summarised yet
    await addDay(1, YESTERDAY, { playing: 50 });
    await addDaily(1, YESTERDAY, 7);                           // already summarised
    await dailyMaintenance(env, NOW);

    expect(await rows("SELECT day, peak_playing FROM daily ORDER BY day")).toEqual([
      { day: YESTERDAY - 2 * DAY, peak_playing: 40 },
      { day: YESTERDAY, peak_playing: 7 },
    ]);
  });

  it("deletes hourly rows older than 90 days, keeping their daily summaries", async () => {
    await addGame(1);
    await addReading(1, TODAY - 91 * DAY);
    await addReading(1, TODAY - 89 * DAY);
    await addDaily(1, TODAY - 91 * DAY, 10);
    await dailyMaintenance(env, NOW);

    expect(await rows("SELECT hour FROM snapshots")).toEqual([{ hour: TODAY - 89 * DAY }]);
    expect(await rows("SELECT day FROM daily")).toEqual([{ day: TODAY - 91 * DAY }]);
  });

  it("pauses games with no players for 30 days, but not new games or ones with players", async () => {
    const LONG_AGO = TODAY - 60 * DAY;
    await addGame(1, { tracked_since: LONG_AGO }); // empty for the last 30 days
    await addDaily(1, TODAY - 40 * DAY, 25);       // (it had players before that)
    await addDaily(1, TODAY - 10 * DAY, 0);
    await addGame(2, { tracked_since: LONG_AGO }); // had one player 20 days ago
    await addDaily(2, TODAY - 20 * DAY, 1);
    await addGame(3, { tracked_since: TODAY - 10 * DAY }); // empty, but only tracked for 10 days
    await dailyMaintenance(env, NOW);

    expect(await rows("SELECT universe_id, active FROM games ORDER BY universe_id")).toEqual([
      { universe_id: 1, active: 0 }, { universe_id: 2, active: 1 }, { universe_id: 3, active: 1 },
    ]);
    expect(await rows("SELECT COUNT(*) AS n FROM daily WHERE universe_id = 1")).toEqual([{ n: 2 }]); // history kept
  });

  it("notes what it did, for the status page", async () => {
    await addGame(1, { tracked_since: TODAY - 60 * DAY });
    await addDay(1, YESTERDAY, { playing: 0 });
    await addReading(1, TODAY - 100 * DAY);
    await dailyMaintenance(env, NOW);

    expect(await getMeta("last_maintenance")).toMatchObject({
      daysSummarised: 1, hourlyRowsDeleted: 1, gamesPaused: 1,
    });
  });
});
