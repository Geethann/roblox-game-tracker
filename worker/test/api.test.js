// The public API the website uses: replies, input checks, caching, rate limits
// and the safeguards on adding new games.
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import {
  DAY, addGame, addReading, fakeRoblox, resetDatabase, rows, setMeta, today,
} from "./helpers.js";

beforeEach(resetDatabase);
afterEach(() => vi.unstubAllGlobals());

// Answers are cached by address, and the cache lasts for the whole file, so
// each test uses its own game IDs and search words.
let visitorNumber = 0;

/** Sends a request to the backend, like a visitor's browser would. */
async function request(path, { method = "GET", ip, envChanges = {} } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://api.example${path}`, {
      method, headers: { "CF-Connecting-IP": ip ?? `10.0.0.${++visitorNumber}` },
    }),
    { ...env, ...envChanges },
    ctx,
  );
  await waitOnExecutionContext(ctx); // let it finish saving to the cache
  return response;
}

const limiterSaying = (success) => ({ limit: async () => ({ success }) });

describe("every reply", () => {
  it("carries the protective headers", async () => {
    const response = await request("/api/status");
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    });
  });

  it("answers browsers' OPTIONS check, and refuses anything except reading", async () => {
    expect((await request("/api/status", { method: "OPTIONS" })).status).toBe(200);
    const response = await request("/api/status", { method: "POST" });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Only GET requests are supported" });
  });

  it("gives 404 for unknown addresses, and sends the bare address to the status page", async () => {
    expect((await request("/api/nope")).status).toBe(404);
    expect((await request("/elsewhere")).status).toBe(404);
    const home = await request("/");
    expect(home.status).toBe(302);
    expect(home.headers.get("Location")).toBe("https://api.example/api/status");
  });
});

describe("input checks", () => {
  it.each([
    ["/api/games/abc", 404],
    ["/api/games/1234567890123456", 404],        // IDs are at most 15 digits
    ["/api/games/1/history?range=2w", 400],
    ["/api/games/1/history?range=constructor", 400], // not fooled by built-in object names
    ["/api/search?q=a", 400],
    [`/api/search?q=${"x".repeat(51)}`, 400],
  ])("%s is refused with %i", async (path, status) => {
    const response = await request(path);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store"); // errors are never cached
  });
});

describe("rate limits and caching", () => {
  it("turns away a visitor who sends too many requests", async () => {
    const response = await request("/api/status", { envChanges: { API_LIMITER: limiterSaying(false) } });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it("still works if the rate limiter itself fails", async () => {
    const broken = { limit: async () => { throw new Error("limiter down"); } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await request("/api/leaderboards", { envChanges: { API_LIMITER: broken } })).status).toBe(200);
  });

  it("reuses recent answers", async () => {
    await request("/api/charts");
    expect((await request("/api/charts")).headers.get("X-Cache")).toBe("HIT");
  });

  it("doesn't fall over if something goes wrong, and doesn't show visitors the details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeRoblox({ down: ["games"] });
    const response = await request("/api/games/111");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Something went wrong") });
  });
});

describe("a game's page", () => {
  it("shows live numbers, the rank from the charts job, and starts tracking a game with players", async () => {
    fakeRoblox({ games: { 200: { name: "Hit Game", playing: 5, visits: 50 } } });
    await setMeta("game_ranks", { total: 10, ranks: { 200: [3, 0.25] } });
    const game = await (await request("/api/games/200")).json();

    expect(game).toMatchObject({
      universeId: 200, name: "Hit Game", playing: 5, icon: "https://tr.rbxcdn.com/v1/200",
      rank: { position: 3, of: 10 }, change24h: 0.25,
      isTracking: true, notTrackedReason: null, trackedSince: expect.any(Number),
    });
    // Its first reading is saved straight away, so its history starts now.
    expect(await rows("SELECT source FROM games WHERE universe_id = 200")).toEqual([{ source: "search" }]);
    expect(await rows("SELECT playing FROM snapshots WHERE universe_id = 200")).toEqual([{ playing: 5 }]);
    expect(await rows("SELECT kind FROM events WHERE universe_id = 200")).toEqual([{ kind: "update" }]);
  });

  it("starts tracking a game with no players if it has 1,000+ visits", async () => {
    fakeRoblox({ games: { 201: { playing: 0, visits: 1000 } } });
    expect(await (await request("/api/games/201")).json()).toMatchObject({ isTracking: true });
  });

  it("doesn't track quiet games (no players and under 1,000 visits)", async () => {
    fakeRoblox({ games: { 202: { playing: 0, visits: 999 } } });
    const game = await (await request("/api/games/202")).json();
    expect(game).toMatchObject({ isTracking: false, notTrackedReason: "quiet", trackedSince: null });
    expect(await rows("SELECT * FROM games")).toEqual([]);
  });

  it("only lets one visitor add a few games a minute", async () => {
    fakeRoblox({ games: { 203: {} } });
    const response = await request("/api/games/203", { envChanges: { TRACK_LIMITER: limiterSaying(false) } });
    expect(await response.json()).toMatchObject({ isTracking: false, notTrackedReason: "busy" });
  });

  it("stops adding games through search after 200 in a day", async () => {
    for (let id = 1; id <= 200; id++) {
      await addGame(id, { source: "search", tracked_since: Math.floor(Date.now() / 1000) - 60 });
    }
    fakeRoblox({ games: { 204: {} } });
    expect(await (await request("/api/games/204")).json()).toMatchObject({ notTrackedReason: "busy" });
  });

  it("doesn't go over the tracking limit", async () => {
    await addGame(1);
    fakeRoblox({ games: { 205: {} } });
    const response = await request("/api/games/205", { envChanges: { MAX_TRACKED_GAMES: "1" } });
    expect(await response.json()).toMatchObject({ notTrackedReason: "full" });
  });

  it("switches a paused game back on, keeping when its history started", async () => {
    await addGame(206, { active: 0, tracked_since: 1_780_000_000 });
    fakeRoblox({ games: { 206: {} } });
    const game = await (await request("/api/games/206")).json();

    expect(game).toMatchObject({ isTracking: true, trackedSince: 1_780_000_000 });
    expect(await rows("SELECT active FROM games WHERE universe_id = 206")).toEqual([{ active: 1 }]);
  });

  it("shows a tracked game's last hourly reading, marked stale, if Roblox is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await addGame(209, { name: "Saved Game", icon: "https://tr.rbxcdn.com/saved" });
    await addReading(209, 1_790_000_000, { playing: 7 });
    await addReading(209, 1_790_003_600, { playing: 8 });
    fakeRoblox({ down: ["games", "thumbnails"] });
    const response = await request("/api/games/209");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store"); // try Roblox again next time
    expect(await response.json()).toMatchObject({
      universeId: 209, name: "Saved Game", playing: 8, icon: "https://tr.rbxcdn.com/saved",
      stale: true, fetchedAt: 1_790_003_600, isTracking: true,
    });
  });

  it("tries again quickly if Roblox refuses once, so the page isn't slowed down", async () => {
    fakeRoblox({ games: { 211: { playing: 4 } }, refuse: { details: 1, votes: 1 } });
    const started = Date.now();
    const response = await request("/api/games/211");
    expect(Date.now() - started).toBeLessThan(1500); // the old policy waited 2s before retrying
    expect(await response.json()).toMatchObject({ playing: 4, likes: 90, stale: false });
    expect(response.headers.get("Server-Timing")).toMatch(/details;dur=\d+;desc="2 tries, HTTP 429"/);
  });

  it("still shows live numbers if only the likes/dislikes request fails, using the saved ones", async () => {
    await addGame(212);
    await addReading(212, 1_790_000_000, { likes: 70, dislikes: 30 });
    fakeRoblox({ games: { 212: { playing: 9 } }, down: ["votes"] });
    expect(await (await request("/api/games/212")).json())
      .toMatchObject({ playing: 9, likes: 70, dislikes: 30, stale: false });
  });

  it("uses the saved icon if the icon request fails", async () => {
    await addGame(213, { icon: "https://tr.rbxcdn.com/saved/213" });
    await addReading(213, 1_790_000_000);
    fakeRoblox({ games: { 213: {} }, down: ["thumbnails"] });
    expect(await (await request("/api/games/213")).json())
      .toMatchObject({ icon: "https://tr.rbxcdn.com/saved/213", stale: false });
  });

  it("never says a game we track doesn't exist: an empty or placeholder answer shows the last reading", async () => {
    await addGame(214, { name: "Tracked Game" });
    await addReading(214, 1_790_000_000, { playing: 3 });
    fakeRoblox({ placeholders: [214] });
    const response = await request("/api/games/214");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Tracked Game", playing: 3, stale: true });
  });

  it("doesn't keep a visitor waiting long when Roblox keeps refusing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await addGame(215);
    await addReading(215, 1_790_000_000, { playing: 6 });
    fakeRoblox({ games: { 215: {} }, refuse: { details: 5, votes: 5, thumbnails: 5 } });
    const started = Date.now();
    const game = await (await request("/api/games/215")).json();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(game).toMatchObject({ playing: 6, stale: true });
  });

  it("live answers say they're live", async () => {
    fakeRoblox({ games: { 210: {} } });
    expect(await (await request("/api/games/210")).json()).toMatchObject({ stale: false });
  });

  it("gives 404 for an ID Roblox doesn't know", async () => {
    fakeRoblox({ games: {} });
    expect((await request("/api/games/207")).status).toBe(404);
  });

  it("gives 404 when Roblox answers with its \"[TITLE UNAVAILABLE]\" placeholder", async () => {
    fakeRoblox({ placeholders: [208] });
    const response = await request("/api/games/208");
    expect(response.status).toBe(404);
    expect(await rows("SELECT * FROM games")).toEqual([]);
  });
});

describe("a game's history", () => {
  it("uses hourly readings for short ranges, with update markers", async () => {
    const start = today();
    await addReading(300, start, { playing: 10 });
    await addReading(300, start + 1, { playing: 30 });
    await env.DB.prepare("INSERT INTO events (universe_id, at, kind) VALUES (300, ?1, 'update')").bind(start).run();
    const history = await (await request("/api/games/300/history?range=7d")).json();

    expect(history).toMatchObject({ resolution: "hour", events: [{ t: start, kind: "update", detail: null }] });
    expect(history.points.map((point) => point.playing)).toEqual([10, 30]);
  });

  it("uses daily summaries for long ranges, plus today worked out on the spot", async () => {
    const start = today();
    await env.DB.prepare("INSERT INTO daily VALUES (301, ?1, 7, 9, 4000, 40, 80, 8)").bind(start - 3 * DAY).run();
    await addReading(301, start, { playing: 10, visits: 4100 });
    await addReading(301, start + 1, { playing: 30, visits: 4200 });
    const history = await (await request("/api/games/301/history?range=90d")).json();

    expect(history.resolution).toBe("day");
    expect(history.points).toEqual([
      { t: start - 3 * DAY, playing: 7, peak: 9, visits: 4000, favorites: 40, likes: 80, dislikes: 8 },
      { t: start, playing: 20, peak: 30, visits: 4200, favorites: 50, likes: 90, dislikes: 10 },
    ]);
  });

  it("doesn't let an empty history be cached (the first reading is about to appear)", async () => {
    const response = await request("/api/games/302/history?range=24h");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("search", () => {
  it("searches Roblox, leaving out adverts, and says which games are already tracked", async () => {
    await addGame(400, { tracked_since: 1_780_000_000 });
    fakeRoblox({ search: [
      { contentType: "Game", universeId: 400, rootPlaceId: 4000, name: "Blox Fruits", creatorName: "", playerCount: 5 },
      { contentType: "Game", universeId: 401, name: "Sponsored Game", isSponsored: true },
      { contentType: "User", name: "Not a game" },
    ] });
    const reply = await (await request("/api/search?q=blox")).json();

    expect(reply).toMatchObject({ query: "blox", source: "roblox" });
    expect(reply.results).toEqual([{
      universeId: 400, rootPlaceId: 4000, name: "Blox Fruits", creatorName: null,
      playing: 5, likes: null, dislikes: null,
      icon: "https://tr.rbxcdn.com/v1/400", trackedSince: 1_780_000_000,
    }]);
  });

  it("falls back to the games we track if Roblox's search fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await addGame(402, { name: "Pet Simulator" });
    await addGame(403, { name: "Racing" });
    fakeRoblox({ down: ["search"] });
    const reply = await (await request("/api/search?q=simulator")).json();

    expect(reply.source).toBe("tracked");
    expect(reply.results.map((game) => game.name)).toEqual(["Pet Simulator"]);
  });
});

describe("saved results", () => {
  it("sends the charts job's saved lists exactly as stored", async () => {
    const saved = JSON.stringify({ at: 1, lists: { mostPlayed: [{ universeId: 1 }] } });
    await env.DB.prepare("INSERT INTO meta VALUES ('leaderboards', ?1)").bind(saved).run();
    expect(await (await request("/api/leaderboards?fresh=1")).text()).toBe(saved);
  });

  it("sends an empty answer before the charts job has ever run", async () => {
    expect(await (await request("/api/charts?fresh=1")).json()).toEqual({ at: null, rules: {}, games: [] });
  });

  it("reports the tracker's health on the status page", async () => {
    await addGame(1);
    await addGame(2, { active: 0 });
    await setMeta("last_collect", { at: 5, slice: 0, games: 1 });
    expect(await (await request("/api/status?fresh=1")).json()).toEqual({
      trackedGames: 1, maxGames: 1500, last_collect: { at: 5, slice: 0, games: 1 },
    });
  });
});
