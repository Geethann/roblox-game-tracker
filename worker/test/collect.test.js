// The hourly readings: what gets saved, and when updates and renames are recorded.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectSlice } from "../src/collect.js";
import { addGame, fakeRoblox, getMeta, resetDatabase, rows } from "./helpers.js";

// 13:15 UTC is slice 3, which holds the games whose ID leaves 3 when divided by 12.
const NOW = new Date(Date.UTC(2026, 10, 14, 13, 15));
const HOUR = Date.UTC(2026, 10, 14, 13) / 1000;

beforeEach(resetDatabase);
afterEach(() => vi.unstubAllGlobals());

describe("collecting a slice", () => {
  it("saves this hour's numbers for the active games in its slice only", async () => {
    await addGame(3);
    await addGame(15);
    await addGame(4);                // a different slice
    await addGame(27, { active: 0 }); // paused
    const requested = fakeRoblox({ games: {
      3: { playing: 42, visits: 9000, favorites: 7, likes: 80, dislikes: 20 }, 15: {}, 4: {}, 27: {},
    } });

    await collectSlice(env, 3, NOW);

    expect(await rows("SELECT * FROM snapshots ORDER BY universe_id")).toEqual([
      { universe_id: 3, hour: HOUR, playing: 42, visits: 9000, favorites: 7, likes: 80, dislikes: 20 },
      { universe_id: 15, hour: HOUR, playing: 10, visits: 5000, favorites: 50, likes: 90, dislikes: 10 },
    ]);
    expect(requested.join(" ")).not.toMatch(/\b(4|27)\b/);
    expect(await getMeta("last_collect")).toMatchObject({ slice: 3, games: 2 });
  });

  it("keeps the first reading if the same hour is collected twice", async () => {
    await addGame(3);
    fakeRoblox({ games: { 3: { playing: 42 } } });
    await collectSlice(env, 3, NOW);
    fakeRoblox({ games: { 3: { playing: 99 } } });
    await collectSlice(env, 3, NOW);

    expect(await rows("SELECT playing FROM snapshots")).toEqual([{ playing: 42 }]);
  });

  it("skips games Roblox no longer knows about", async () => {
    await addGame(3);
    fakeRoblox({ games: {} });
    await collectSlice(env, 3, NOW);

    expect(await rows("SELECT * FROM snapshots")).toEqual([]);
    expect(await getMeta("last_collect")).toMatchObject({ games: 0 });
  });

  it("records an update when the developer publishes, and a rename when the title changes", async () => {
    await addGame(3, { name: "Old Name", last_updated: 1_790_000_000 });
    fakeRoblox({ games: { 3: { name: "New Name", updated: "2026-11-14T12:00:00Z" } } });
    await collectSlice(env, 3, NOW);

    const events = await rows("SELECT kind, at, detail FROM events ORDER BY kind DESC");
    expect(events).toEqual([
      { kind: "update", at: Date.UTC(2026, 10, 14, 12) / 1000, detail: null },
      { kind: "rename", at: expect.any(Number), detail: "New Name" },
    ]);
    expect(await rows("SELECT name, last_updated FROM games"))
      .toEqual([{ name: "New Name", last_updated: Date.UTC(2026, 10, 14, 12) / 1000 }]);
  });

  it("doesn't record anything when nothing changed", async () => {
    await addGame(3);
    fakeRoblox({ games: { 3: {} } });
    await collectSlice(env, 3, NOW);
    expect(await rows("SELECT * FROM events")).toEqual([]);
  });

  it("doesn't count a game's very first collection as a rename", async () => {
    await addGame(3, { name: null, last_updated: null, created_at: null }); // just discovered
    fakeRoblox({ games: { 3: { name: "Brand New" } } });
    await collectSlice(env, 3, NOW);

    expect(await rows("SELECT kind FROM events")).toEqual([{ kind: "update" }]);
    expect(await rows("SELECT name, created_at FROM games"))
      .toEqual([{ name: "Brand New", created_at: 1_700_000_000 }]);
  });

  it("only rewrites a game's details when something changed (database writes are limited)", async () => {
    // root_place_id isn't one of the things checked for changes, so a wrong value
    // that survives the collection proves the game's row wasn't rewritten.
    await addGame(3, { root_place_id: 999, icon: "https://tr.rbxcdn.com/v1/3" });
    fakeRoblox({ games: { 3: {} } });
    await collectSlice(env, 3, NOW);
    expect(await rows("SELECT root_place_id FROM games")).toEqual([{ root_place_id: 999 }]);

    fakeRoblox({ games: { 3: { genre: "Simulation" } } });
    await collectSlice(env, 3, new Date(+NOW + 3_600_000));
    expect(await rows("SELECT root_place_id, genre FROM games"))
      .toEqual([{ root_place_id: 30, genre: "Simulation" }]);
  });

  it("saves icons, keeps the old ones if Roblox's icon service is down, and picks up new ones", async () => {
    await addGame(3);
    const icon = async () => (await rows("SELECT icon FROM games"))[0].icon;

    fakeRoblox({ games: { 3: {} } });
    await collectSlice(env, 3, NOW);
    expect(await icon()).toBe("https://tr.rbxcdn.com/v1/3");

    fakeRoblox({ games: { 3: {} }, down: ["thumbnails"] });
    await collectSlice(env, 3, new Date(+NOW + 3_600_000));
    expect(await icon()).toBe("https://tr.rbxcdn.com/v1/3");
    expect(await rows("SELECT COUNT(*) AS n FROM snapshots")).toEqual([{ n: 2 }]); // readings still saved

    fakeRoblox({ games: { 3: {} }, iconVersion: "v2" });
    await collectSlice(env, 3, new Date(+NOW + 7_200_000));
    expect(await icon()).toBe("https://tr.rbxcdn.com/v2/3");
  });
});
