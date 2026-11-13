// The chart views ("Most played", "Rising", ...) and how the full table is
// sorted and filtered. Plain functions, no React.
//
// The thresholds (e.g. "at least 100 players yesterday") come from the API
// as `rules`, so these pages always match the home page lists exactly.

export const VIEWS = [
  {
    key: "most-played", title: "Most played", sort: "playing",
    describe: () => "Players online right now.",
  },
  {
    key: "trending-on-roblox", title: "Trending on Roblox", sort: "robloxTrendingRank", dir: "asc",
    describe: () => "Roblox's own Trending list, in Roblox's order. Refreshed hourly.",
    include: (game) => game.robloxTrendingRank != null,
  },
  {
    key: "rising", title: "Rising", sort: "change24h",
    describe: (rules) => `Biggest rise in players compared with this time yesterday. Games with fewer than ${rules.risingMinPlayers} players yesterday are left out, as small numbers swing wildly.`,
    include: (game, rules) => game.playing24hAgo >= rules.risingMinPlayers,
  },
  {
    key: "visits-today", title: "Most visits today", sort: "visits24h",
    describe: () => "New visits in the last 24 hours.",
  },
  {
    key: "top-rated", title: "Top rated", sort: "rating",
    describe: (rules) => `Highest share of likes, among games with at least ${rules.topRatedMinVotes.toLocaleString()} votes and ${rules.topRatedMinPlayers} players online.`,
    include: (game, rules) => game.votes >= rules.topRatedMinVotes && game.playing >= rules.topRatedMinPlayers,
  },
  {
    key: "recently-updated", title: "Recently updated", sort: "lastUpdated",
    describe: () => "Latest updates published by developers.",
  },
];
export const DEFAULT_VIEW = VIEWS[0].key;
export const findView = (key) => VIEWS.find((v) => v.key === key) ?? VIEWS[0];

/** Columns you can sort by, and which way they sort first when clicked. */
export const SORTABLE = {
  name: "asc", playing: "desc", change24h: "desc", visits24h: "desc",
  rating: "desc", lastUpdated: "desc", robloxTrendingRank: "asc",
};
export const isSortable = (key) => Object.hasOwn(SORTABLE, key);

export const MIN_PLAYER_OPTIONS = [0, 100, 1_000, 10_000];

/** Apply the view's own rule, then the visitor's search / genre / minimum players. */
export function filterGames(games, { view, rules, query, genre, minPlayers }) {
  const text = query.trim().toLowerCase();
  return games.filter((game) =>
    (!view.include || view.include(game, rules))
    && (!text || game.name.toLowerCase().includes(text) || game.creatorName?.toLowerCase().includes(text))
    && (!genre || game.genre === genre)
    && (game.playing ?? 0) >= minPlayers);
}

/** Sort by one column. Games missing that number always go to the bottom. */
export function sortGames(games, key, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...games].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === "string") return sign * x.localeCompare(y);
    return sign * (x - y);
  });
}

/** Every genre in the data, most common first: [{ genre, count }] */
export function genreOptions(games) {
  const counts = new Map();
  for (const game of games) if (game.genre) counts.set(game.genre, (counts.get(game.genre) ?? 0) + 1);
  return [...counts].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count);
}
