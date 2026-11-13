// Everything that talks to Roblox's public API lives in this file.

const HEADERS = { "User-Agent": "roblox-game-tracker (Cloudflare Worker)" };

// Roblox's limits, measured: 50 games per details request, 100 per votes or icons request.
const DETAILS_PER_REQUEST = 50;
const VOTES_PER_REQUEST = 100;
const ICONS_PER_REQUEST = 100;

/**
 * Download a URL and return the JSON reply.
 * Retries "too many requests" (429) and Roblox server errors (5xx), waiting
 * a little longer each time. Other errors (like 404) won't fix themselves,
 * so those fail straight away.
 */
export async function getJson(url, attempts = 3) {
  let problem;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers: HEADERS });
    } catch (error) {
      problem = error.message; // network trouble: worth a retry
    }
    if (response) {
      if (response.ok) return response.json();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      problem = `HTTP ${response.status}`;
    }
    if (attempt < attempts) await sleep(2000 * attempt);
  }
  throw new Error(`Gave up on ${url} after ${attempts} attempts (${problem})`);
}

/**
 * Current stats for any number of games, using as few requests as possible.
 * Returns one object per game that Roblox still knows about.
 */
export async function fetchGameStats(universeIds) {
  const detailRequests = chunk(universeIds, DETAILS_PER_REQUEST).map((ids) =>
    getJson(`https://games.roblox.com/v1/games?universeIds=${ids.join(",")}`));
  const voteRequests = chunk(universeIds, VOTES_PER_REQUEST).map((ids) =>
    getJson(`https://games.roblox.com/v1/games/votes?universeIds=${ids.join(",")}`));

  // Send every request at the same time and wait for all the replies.
  const [details, votes] = await Promise.all([
    Promise.all(detailRequests),
    Promise.all(voteRequests),
  ]);

  const votesById = new Map(votes.flatMap((reply) => reply.data).map((v) => [v.id, v]));

  return details.flatMap((reply) => reply.data).map((game) => ({
    universeId: game.id,
    rootPlaceId: game.rootPlaceId,
    name: game.name,
    creatorName: game.creator?.name ?? null,
    createdAt: toUnix(game.created),
    lastUpdated: toUnix(game.updated),
    playing: game.playing,
    visits: game.visits,
    favorites: game.favoritedCount,
    likes: votesById.get(game.id)?.upVotes ?? null,
    dislikes: votesById.get(game.id)?.downVotes ?? null,
  }));
}

/**
 * Every game currently on Roblox's front-page lists (Top Playing Now,
 * Top Trending, Up-and-Coming, ...). Roblox doesn't officially document
 * this endpoint, so it may change; only discovery depends on it.
 */
export async function fetchFrontPageGames() {
  const reply = await getJson(
    `https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${crypto.randomUUID()}&device=computer`);
  return (reply.sorts ?? [])
    .flatMap((sort) => sort.games ?? [])
    .filter((game) => game.universeId)
    .map((game) => ({ universeId: game.universeId, rootPlaceId: game.rootPlaceId }));
}

/**
 * Search Roblox for games by name, the same search the Roblox website uses.
 * Adverts (sponsored results) are left out. Like the front-page lists, this
 * endpoint isn't officially documented, so callers should handle failures.
 */
export async function searchGames(query) {
  const reply = await getJson(
    "https://apis.roblox.com/search-api/omni-search?pageType=all"
    + `&searchQuery=${encodeURIComponent(query)}&sessionId=${crypto.randomUUID()}`);
  return (reply.searchResults ?? [])
    .flatMap((group) => group.contents ?? [])
    .filter((item) => item.contentType === "Game" && !item.isSponsored)
    .map((item) => ({
      universeId: item.universeId,
      rootPlaceId: item.rootPlaceId,
      name: item.name,
      creatorName: item.creatorName ?? null,
      playing: item.playerCount ?? null,
      likes: item.totalUpVotes ?? null,
      dislikes: item.totalDownVotes ?? null,
    }));
}

/**
 * Icon image links for games, as a Map of universeId -> image URL.
 * The images themselves load straight from Roblox's image servers;
 * only this lookup has to go through our backend.
 */
export async function fetchIcons(universeIds) {
  const replies = await Promise.all(chunk(universeIds, ICONS_PER_REQUEST).map((ids) =>
    getJson("https://thumbnails.roblox.com/v1/games/icons?size=150x150&format=Webp"
      + `&isCircular=false&returnPolicy=PlaceHolder&universeIds=${ids.join(",")}`)));
  return new Map(replies
    .flatMap((reply) => reply.data)
    .filter((icon) => icon.state === "Completed")
    .map((icon) => [icon.targetId, icon.imageUrl]));
}

// ---- small helpers ----

/** Split a list into pieces of at most `size` items: chunk([1,2,3], 2) -> [[1,2],[3]] */
function chunk(list, size) {
  const pieces = [];
  for (let i = 0; i < list.length; i += size) pieces.push(list.slice(i, i + size));
  return pieces;
}

/** "2026-11-11T00:38:16.477Z" -> 1762821496 (seconds since 1 Jan 1970, UTC) */
function toUnix(isoDate) {
  return isoDate ? Math.floor(Date.parse(isoDate) / 1000) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
