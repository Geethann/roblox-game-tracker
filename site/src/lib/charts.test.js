// Tests for the charts pages: sorting, filtering and each list's rules.
import { describe, expect, it } from "vitest";
import { filterGames, findView, genreOptions, sortGames } from "./charts.js";

const RULES = { risingMinPlayers: 100, topRatedMinVotes: 1000, topRatedMinPlayers: 100 };
const game = (name, extra = {}) => ({
  universeId: name.length, name, creatorName: `${name} Studio`, genre: "Action",
  playing: 1000, playing24hAgo: 800, change24h: 0.25, votes: 5000, rating: 0.9, ...extra,
});
const filters = (overrides = {}) => ({ view: findView("most-played"), rules: RULES, query: "", genre: "", minPlayers: 0, ...overrides });

describe("sortGames", () => {
  const games = [game("A", { playing: 5 }), game("B", { playing: null }), game("C", { playing: 50 })];

  it("sorts high to low and low to high", () => {
    expect(sortGames(games, "playing", "desc").map((g) => g.name)).toEqual(["C", "A", "B"]);
    expect(sortGames(games, "playing", "asc").map((g) => g.name)).toEqual(["A", "C", "B"]);
  });

  it("always puts missing numbers at the bottom, whichever way you sort", () => {
    expect(sortGames(games, "playing", "asc").at(-1).name).toBe("B");
    expect(sortGames(games, "playing", "desc").at(-1).name).toBe("B");
  });

  it("sorts names alphabetically", () => {
    expect(sortGames([game("beta"), game("Alpha")], "name", "asc").map((g) => g.name)).toEqual(["Alpha", "beta"]);
  });

  it("doesn't change the original list", () => {
    const original = [...games];
    sortGames(games, "playing", "desc");
    expect(games).toEqual(original);
  });
});

describe("filterGames", () => {
  it("leaves games under 100 players yesterday out of Rising", () => {
    const games = [game("Big", { playing24hAgo: 500 }), game("Tiny", { playing24hAgo: 3 })];
    const result = filterGames(games, filters({ view: findView("rising") }));
    expect(result.map((g) => g.name)).toEqual(["Big"]);
  });

  it("needs enough votes AND players for Top rated", () => {
    const games = [game("Ok"), game("FewVotes", { votes: 10 }), game("Empty", { playing: 5 })];
    expect(filterGames(games, filters({ view: findView("top-rated") })).map((g) => g.name)).toEqual(["Ok"]);
  });

  it("only shows Roblox's own list in Trending on Roblox", () => {
    const games = [game("Listed", { robloxTrendingRank: 4 }), game("NotListed", { robloxTrendingRank: null })];
    expect(filterGames(games, filters({ view: findView("trending-on-roblox") })).map((g) => g.name)).toEqual(["Listed"]);
  });

  it("searches names and creators, ignoring capitals", () => {
    const games = [game("Steal An Egg"), game("Other", { creatorName: "STEALTHY Games" }), game("Nope")];
    expect(filterGames(games, filters({ query: "steal" }))).toHaveLength(2);
  });

  it("combines genre and minimum players", () => {
    const games = [game("Match", { genre: "Simulation", playing: 5000 }), game("Small", { genre: "Simulation", playing: 50 }), game("Wrong", { genre: "Action", playing: 5000 })];
    const result = filterGames(games, filters({ genre: "Simulation", minPlayers: 1000 }));
    expect(result.map((g) => g.name)).toEqual(["Match"]);
  });
});

describe("findView and genreOptions", () => {
  it("falls back to Most played for an unknown list", () => {
    expect(findView("nonsense").key).toBe("most-played");
  });

  it("lists genres most common first, skipping games without one", () => {
    const games = [game("A", { genre: "Sim" }), game("B", { genre: "Sim" }), game("C", { genre: "Action" }), game("D", { genre: null })];
    expect(genreOptions(games)).toEqual([{ genre: "Sim", count: 2 }, { genre: "Action", count: 1 }]);
  });
});
