// The hourly charts job: the full charts table, the home page lists and game ranks.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHART_RULES, updateCharts } from "../src/maintenance.js";
import { DAY, HOUR, addGame, addReading, getMeta, resetDatabase, setMeta, thisHour } from "./helpers.js";

beforeEach(resetDatabase);
afterEach(() => vi.unstubAllGlobals());

/** Adds a game with a reading now and (optionally) one from exactly 24 hours ago. */
async function game(id, now, dayAgo = null, fields = {}) {
  await addGame(id, fields);
  await addReading(id, thisHour(), now);
  if (dayAgo) await addReading(id, thisHour() - DAY, dayAgo);
}

const ids = (list) => list.map((entry) => entry.universeId);

describe("the charts job's cost", () => {
  // The free plan allows 5 million rows read a day, and this job runs every hour.
  // It once looked through each game's whole history, reading ~465,000 rows an
  // hour after two days and growing every hour, until the database refused all
  // queries for the rest of the day. It must only look at the last few hours.
  const GAMES = 100;

  /** 100 games, each with `hours` of hourly readings; returns the rows the job read. */
  async function rowsReadWith(hours) {
    await resetDatabase();
    const statements = [];
    for (let id = 1; id <= GAMES; id++) {
      statements.push(env.DB.prepare(
        "INSERT INTO games (universe_id, root_place_id, name, tracked_since, source, active) VALUES (?1, ?2, ?3, 0, 'discovered', 1)",
      ).bind(id, id * 10, `Game ${id}`));
      for (let h = 0; h < hours; h++) {
        statements.push(env.DB.prepare("INSERT INTO snapshots VALUES (?1, ?2, ?3, 1000, 50, 90, 10)")
          .bind(id, thisHour() - h * HOUR, 100 + h));
      }
    }
    for (let i = 0; i < statements.length; i += 500) await env.DB.batch(statements.slice(i, i + 500));
    // Roblox's Trending list, as the hourly discovery job saves it: matching every
    // game against it was the second thing that made the job expensive.
    await setMeta("roblox_lists", { lists: { "top-trending": { name: "Trending",
      ids: Array.from({ length: GAMES }, (_, i) => GAMES - i) } } });
    const results = await updateCharts(env);
    expect((await getMeta("charts")).games.filter((g) => g.robloxTrendingRank).length).toBe(GAMES);
    expect((await getMeta("charts")).games).toHaveLength(GAMES); // every game is still included
    return results.reduce((sum, r) => sum + r.meta.rows_read, 0);
  }

  it("costs the same with four days of history as with two", async () => {
    // (Both have a reading from 24 hours ago, which the job also looks up.)
    const twoDays = await rowsReadWith(48);
    const fourDays = await rowsReadWith(96);
    expect(twoDays).toBeGreaterThan(0);                 // the database really reports it
    expect(fourDays).toBeLessThanOrEqual(twoDays * 1.02); // history doesn't make it dearer
    expect(fourDays).toBeLessThan(GAMES * 50);          // ~42 rows per game for all three statements (was ~330)
  });
});

describe("the charts job", () => {
  it("builds the full charts table with each game's worked-out numbers", async () => {
    await game(1, { playing: 150, visits: 10_000, favorites: 9, likes: 75, dislikes: 25 },
      { playing: 100, visits: 8_000 }, { name: "Alpha", icon: "https://tr.rbxcdn.com/a" });
    await updateCharts(env);

    const charts = await getMeta("charts");
    expect(charts.rules).toEqual(CHART_RULES);
    expect(charts.games).toEqual([{
      universeId: 1, name: "Alpha", creatorName: "Test Creator", genre: "Action",
      icon: "https://tr.rbxcdn.com/a", playing: 150, playing24hAgo: 100, change24h: 0.5,
      visits: 10_000, visits24h: 2_000, favorites: 9, rating: 0.75, votes: 100,
      lastUpdated: 1_790_000_000, trackedSince: 1_790_000_000, robloxTrendingRank: null,
    }]);
  });

  it("ranks Most played, and gives every game its position", async () => {
    await game(1, { playing: 50 });
    await game(2, { playing: 500 });
    await game(3, { playing: 5 });
    await updateCharts(env);

    const { lists } = await getMeta("leaderboards");
    expect(ids(lists.mostPlayed)).toEqual([2, 1, 3]);
    expect(lists.mostPlayed[0]).toMatchObject({ name: "Game 2", playing: 500, value: 500 });
    expect(await getMeta("game_ranks")).toMatchObject({
      total: 3, ranks: { 2: [1, null], 1: [2, null], 3: [3, null] },
    });
  });

  it("Rising compares with the same hour yesterday, ignoring games under 100 players yesterday", async () => {
    await game(1, { playing: 150 }, { playing: 100 });   // +50%
    await game(2, { playing: 1200 }, { playing: 1000 }); // +20%
    await game(3, { playing: 500 }, { playing: 50 });    // +900%, but too small yesterday
    await game(4, { playing: 900 });                     // no reading from yesterday
    await updateCharts(env);

    const { lists } = await getMeta("leaderboards");
    expect(ids(lists.rising)).toEqual([1, 2]);
    expect(lists.rising[0].value).toBe(0.5);
    const changes = Object.fromEntries((await getMeta("charts")).games.map((g) => [g.universeId, g.change24h]));
    expect(changes).toEqual({ 1: 0.5, 2: 0.2, 3: 9, 4: null });
  });

  it("Top rated needs at least 1,000 votes and 100 players", async () => {
    await game(1, { playing: 200, likes: 990, dislikes: 10 });  // 99%
    await game(2, { playing: 200, likes: 900, dislikes: 100 }); // 90%
    await game(3, { playing: 200, likes: 99, dislikes: 0 });    // 100%, but only 99 votes
    await game(4, { playing: 99, likes: 5000, dislikes: 0 });   // 100%, but only 99 players
    await updateCharts(env);

    const { lists } = await getMeta("leaderboards");
    expect(ids(lists.topRated)).toEqual([1, 2]);
    expect(lists.topRated[0].value).toBe(0.99);
  });

  it("Trending on Roblox follows Roblox's own order", async () => {
    await game(1, { playing: 900 });
    await game(2, { playing: 10 });
    await game(3, { playing: 500 });
    await setMeta("roblox_lists", { lists: { "top-trending": { name: "Trending", ids: [2, 999, 1] } } });
    await updateCharts(env);

    const { lists } = await getMeta("leaderboards");
    expect(ids(lists.trendingOnRoblox)).toEqual([2, 1]); // 999 isn't tracked; 3 isn't trending
    expect(lists.trendingOnRoblox.map((entry) => entry.value)).toEqual([1, 3]);
  });

  it("Most visits today and Recently updated", async () => {
    await game(1, { visits: 5_000 }, { visits: 4_000 }, { last_updated: 1_790_000_300 });
    await game(2, { visits: 90_000 }, { visits: 60_000 }, { last_updated: 1_790_000_100 });
    await game(3, { visits: 7_000 }, null, { last_updated: 1_790_000_200 }); // no reading from yesterday
    await updateCharts(env);

    const { lists } = await getMeta("leaderboards");
    expect(ids(lists.mostVisits24h)).toEqual([2, 1]);
    expect(lists.mostVisits24h.map((entry) => entry.value)).toEqual([30_000, 1_000]);
    expect(ids(lists.recentlyUpdated)).toEqual([1, 3, 2]);
  });

  it("keeps each list to the top 20", async () => {
    for (let id = 1; id <= 25; id++) await game(id, { playing: id });
    await updateCharts(env);

    const { lists } = await getMeta("leaderboards");
    expect(lists.mostPlayed).toHaveLength(20);
    expect(lists.mostPlayed[0].universeId).toBe(25);
    expect((await getMeta("charts")).games).toHaveLength(25); // the full table has everyone
  });

  it("leaves out paused games, games not collected yet, and games with no recent reading", async () => {
    await game(1, { playing: 10 });
    await game(2, { playing: 10 }, null, { active: 0 });   // paused
    await game(3, { playing: 10 }, null, { name: null });  // discovered, not collected yet
    await addGame(4);                                      // newest reading is 3 hours old
    await addReading(4, thisHour() - 3 * HOUR);
    await updateCharts(env);

    expect(ids((await getMeta("charts")).games)).toEqual([1]);
    expect((await getMeta("game_ranks")).total).toBe(1);
  });

  it("works before any games are tracked", async () => {
    await updateCharts(env);

    expect((await getMeta("charts")).games).toEqual([]);
    expect((await getMeta("leaderboards")).lists).toEqual({
      mostPlayed: [], trendingOnRoblox: [], rising: [], mostVisits24h: [], topRated: [], recentlyUpdated: [],
    });
    expect(await getMeta("game_ranks")).toMatchObject({ total: 0, ranks: {} });
  });
});
