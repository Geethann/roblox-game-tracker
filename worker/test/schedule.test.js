// The 5-minute schedule: which jobs run at which times, and finding new games.
import { env } from "cloudflare:workers";
import { createScheduledController } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { addGame, fakeRoblox, getMeta, resetDatabase, rows } from "./helpers.js";

beforeEach(resetDatabase);
afterEach(() => vi.unstubAllGlobals());

/** Runs the scheduled job as if it were this time (UTC). */
async function runAt(hours, minutes, envChanges = {}) {
  const controller = createScheduledController({
    scheduledTime: Date.UTC(2026, 10, 14, hours, minutes), cron: "*/5 * * * *",
  });
  await worker.scheduled(controller, { ...env, ...envChanges });
}

const FRONT_PAGE = [
  { sortId: "top-trending", sortDisplayName: "Trending", games: [
    { universeId: 101, rootPlaceId: 1010 }, { universeId: 102, rootPlaceId: 1020 },
  ] },
  { sortId: "top-playing-now", sortDisplayName: "Top Playing Now", games: [
    { universeId: 102, rootPlaceId: 1020 }, { universeId: 103, rootPlaceId: 1030 },
  ] },
  { sortId: "empty-list", sortDisplayName: "Nothing here", games: [] },
];

describe("the schedule", () => {
  it("collects the slice for the time: 13:25 is slice 5", async () => {
    await addGame(5);
    await addGame(17);
    await addGame(6);
    fakeRoblox({ games: { 5: {}, 17: {}, 6: {} } });
    await runAt(13, 25);

    expect(await rows("SELECT universe_id FROM snapshots ORDER BY universe_id"))
      .toEqual([{ universe_id: 5 }, { universe_id: 17 }]);
  });

  it("rebuilds the charts on the hour (and only then)", async () => {
    await addGame(1);
    fakeRoblox({ games: { 1: {} } });
    await runAt(13, 5);
    expect(await getMeta("charts")).toBeNull();
    await runAt(14, 0);
    expect(await getMeta("charts")).not.toBeNull();
  });

  it("runs the nightly job at 00:05 UTC only", async () => {
    await addGame(1);
    fakeRoblox({ games: { 1: {} } });
    await runAt(1, 5);
    expect(await getMeta("last_maintenance")).toBeNull();
    await runAt(0, 5);
    expect(await getMeta("last_maintenance")).not.toBeNull();
  });
});

describe("when Roblox refuses a slice", () => {
  it("retries the missed slice later in the same hour, so its games get a reading", async () => {
    await addGame(1);
    await addGame(2);
    fakeRoblox({ games: { 1: {}, 2: {} } });
    await runAt(13, 0);                       // slice 0: nothing in it
    fakeRoblox({ games: { 1: {}, 2: {} }, down: ["details"] });
    await runAt(13, 5);                       // slice 1: Roblox refuses
    expect(await rows("SELECT universe_id FROM snapshots")).toEqual([]);

    fakeRoblox({ games: { 1: {}, 2: {} } });
    await runAt(13, 10);                      // slice 2, and slice 1 again
    expect(await rows("SELECT universe_id, hour FROM snapshots ORDER BY universe_id")).toEqual([
      { universe_id: 1, hour: Date.UTC(2026, 10, 14, 13) / 1000 },
      { universe_id: 2, hour: Date.UTC(2026, 10, 14, 13) / 1000 },
    ]);
  });

  it("saves a retry under the current hour, never an earlier one", async () => {
    await addGame(1);
    fakeRoblox({ games: { 1: {} }, down: ["details"] });
    await runAt(13, 5);                       // missed at 13:05
    fakeRoblox({ games: { 1: {} } });
    await runAt(14, 0);
    await runAt(14, 10);                      // the next hour's runs read it as 14:00, not 13:00
    expect(await rows("SELECT hour FROM snapshots")).toEqual([{ hour: Date.UTC(2026, 10, 14, 14) / 1000 }]);
  });

  it("retries only slices that were missed, not ones already saved", async () => {
    await addGame(1);
    fakeRoblox({ games: { 1: {} } });
    await runAt(13, 0);
    await runAt(13, 5);                       // slice 1 saved
    const requested = fakeRoblox({ games: { 1: {} } });
    await runAt(13, 10);
    expect(requested.some((url) => url.includes("universeIds=1"))).toBe(false);
  });

  it("still does the hour's other jobs", async () => {
    await addGame(12);
    fakeRoblox({ games: { 12: {} }, down: ["details"] });
    await runAt(14, 0);
    expect(await getMeta("charts")).not.toBeNull();
  });
});

describe("finding new games", () => {
  it("adds the games on Roblox's front page at half past, once each", async () => {
    await addGame(102, { name: "Already Tracked" });
    fakeRoblox({ sorts: FRONT_PAGE, games: { 102: {} } });
    await runAt(13, 30);

    expect(await rows("SELECT universe_id, root_place_id, source FROM games ORDER BY universe_id")).toEqual([
      { universe_id: 101, root_place_id: 1010, source: "discovered" },
      { universe_id: 102, root_place_id: 1020, source: "discovered" },
      { universe_id: 103, root_place_id: 1030, source: "discovered" },
    ]);
    expect(await getMeta("last_discover")).toMatchObject({ found: 3, added: 2 });
    // Roblox's list order is saved, for the "Trending on Roblox" chart.
    expect((await getMeta("roblox_lists")).lists).toEqual({
      "top-trending": { name: "Trending", ids: [101, 102] },
      "top-playing-now": { name: "Top Playing Now", ids: [102, 103] },
    });
  });

  it("doesn't go over the tracking limit (paused games don't count)", async () => {
    await addGame(1);
    await addGame(2, { active: 0 });
    fakeRoblox({ sorts: FRONT_PAGE, games: { 1: {} } });
    await runAt(13, 30, { MAX_TRACKED_GAMES: "2" });

    expect(await getMeta("last_discover")).toMatchObject({ found: 3, added: 1 });
  });

  it("fills an empty database straight away, without waiting for half past", async () => {
    fakeRoblox({ sorts: FRONT_PAGE });
    await runAt(13, 10);
    expect(await rows("SELECT COUNT(*) AS n FROM games")).toEqual([{ n: 3 }]);
  });
});
