// Everything that talks to Roblox's public API lives in this file.

const HEADERS = { "User-Agent": "roblox-game-tracker (Cloudflare Worker)" };

// Roblox's limits, measured: 50 games per details request, 100 per votes or icons request.
const DETAILS_PER_REQUEST = 50;
const VOTES_PER_REQUEST = 100;
const ICONS_PER_REQUEST = 100;

/**
 * How hard to try when Roblox doesn't answer properly. Roblox sometimes refuses
 * requests ("429 Too Many Requests"), especially from Cloudflare, whose internet
 * addresses are shared with many other sites. A second try usually works.
 *   BACKGROUND - the hourly jobs: nobody is waiting, so up to 3 tries, 2s then 4s apart
 *   VISITOR    - someone is waiting for a page: 2 quick tries 0.3s apart, each given
 *                at most 2.5s, so a page never hangs for long
 *   OPTIONAL   - extras like icons: one try, at most 1.5s (the saved one is used instead)
 */
export const BACKGROUND = { attempts: 3, retryDelayMs: 2000, timeoutMs: 15_000 };
export const VISITOR = { attempts: 2, retryDelayMs: 300, timeoutMs: 2_500 };
export const OPTIONAL = { attempts: 1, retryDelayMs: 0, timeoutMs: 1_500 };

/**
 * Download a URL and return the JSON reply, following one of the policies above.
 * Retries "too many requests" (429), Roblox server errors (5xx), network trouble
 * and timeouts. Other errors (like 404) won't fix themselves, so those fail at once.
 * `trace` (optional) collects how long each request took, for the Server-Timing header.
 */
export async function getJson(url, { attempts, retryDelayMs, timeoutMs } = BACKGROUND, trace = null, label = "roblox") {
  const started = Date.now();
  let problem;
  let tries = 0;
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      tries = attempt;
      let response;
      try {
        response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        problem = error.name === "TimeoutError" ? `no answer within ${timeoutMs}ms` : error.message;
      }
      if (response) {
        if (response.ok) return await response.json();
        if (response.status !== 429 && response.status < 500) {
          throw new Error(`HTTP ${response.status} from ${url}`);
        }
        problem = `HTTP ${response.status}`;
      }
      if (attempt < attempts) await sleep(retryDelayMs * attempt);
    }
    throw new Error(`Gave up on ${url} after ${attempts} attempts (${problem})`);
  } finally {
    if (trace) trace.push({ label, ms: Date.now() - started, tries, problem });
  }
}

/**
 * Current stats for any number of games, using as few requests as possible.
 * Returns one object per game that Roblox still knows about.
 *   policy         how hard to try (see above)
 *   optionalVotes  if the likes/dislikes request fails, still return the rest,
 *                  with `votesUnavailable: true` (used for visitors' pages)
 */
export async function fetchGameStats(universeIds, { policy = BACKGROUND, optionalVotes = false, trace = null } = {}) {
  const detailRequests = chunk(universeIds, DETAILS_PER_REQUEST).map((ids) =>
    getJson(`https://games.roblox.com/v1/games?universeIds=${ids.join(",")}`, policy, trace, "details"));
  const voteRequests = chunk(universeIds, VOTES_PER_REQUEST).map((ids) =>
    getJson(`https://games.roblox.com/v1/games/votes?universeIds=${ids.join(",")}`, policy, trace, "votes"));

  // Send every request at the same time and wait for all the replies.
  const [details, votes] = await Promise.all([
    Promise.all(detailRequests),
    Promise.all(voteRequests).catch((error) => {
      if (!optionalVotes) throw error;
      return null; // carry on without likes/dislikes
    }),
  ]);

  const votesById = new Map((votes ?? []).flatMap((reply) => reply.data).map((v) => [v.id, v]));
  const asked = new Set(universeIds.map(Number));

  return details.flatMap((reply) => reply.data)
    // For some unknown IDs Roblox sends a placeholder ("[TITLE UNAVAILABLE]",
    // ID 0, place 0) instead of leaving the game out. Treat that as "no such game".
    .filter((game) => asked.has(game.id) && game.rootPlaceId > 0)
    .map((game) => ({
      universeId: game.id,
      rootPlaceId: game.rootPlaceId,
      name: game.name,
      creatorName: game.creator?.name ?? null,
      description: game.description ?? "",
      // Roblox's newest, most specific genre first (e.g. "Battlegrounds & Fighting").
      genre: [game.genre_l2, game.genre_l1, game.genre].find((g) => g && g !== "All") ?? null,
      maxPlayers: game.maxPlayers ?? null,
      createdAt: toUnix(game.created),
      lastUpdated: toUnix(game.updated),
      playing: game.playing,
      visits: game.visits,
      favorites: game.favoritedCount,
      likes: votesById.get(game.id)?.upVotes ?? null,
      dislikes: votesById.get(game.id)?.downVotes ?? null,
      ...(votes === null && { votesUnavailable: true }),
    }));
}

/**
 * Roblox's front-page lists (Top Trending, Up-and-Coming, Top Playing Now, ...).
 * Returns every game on them (for discovery) and each list's order (for the
 * "Trending on Roblox" chart). Roblox doesn't officially document this
 * endpoint, so it may change; only discovery depends on it.
 */
export async function fetchFrontPageLists() {
  const reply = await getJson(
    `https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${crypto.randomUUID()}&device=computer`);
  const lists = (reply.sorts ?? [])
    .filter((sort) => sort.sortId && sort.games?.length)
    .map((sort) => ({
      id: sort.sortId, // e.g. "top-trending"
      name: sort.sortDisplayName,
      games: sort.games
        .filter((game) => game.universeId)
        .map((game) => ({ universeId: game.universeId, rootPlaceId: game.rootPlaceId })),
    }));
  return { lists, games: lists.flatMap((list) => list.games) };
}

/**
 * Search Roblox for games by name, the same search the Roblox website uses.
 * Adverts (sponsored results) are left out. Like the front-page lists, this
 * endpoint isn't officially documented, so callers should handle failures.
 */
export async function searchGames(query, { policy = BACKGROUND, trace = null } = {}) {
  const reply = await getJson(
    "https://apis.roblox.com/search-api/omni-search?pageType=all"
    + `&searchQuery=${encodeURIComponent(query)}&sessionId=${crypto.randomUUID()}`, policy, trace, "search");
  return (reply.searchResults ?? [])
    .flatMap((group) => group.contents ?? [])
    .filter((item) => item.contentType === "Game" && !item.isSponsored)
    .map((item) => ({
      universeId: item.universeId,
      rootPlaceId: item.rootPlaceId,
      name: item.name,
      creatorName: item.creatorName || null, // Roblox sometimes sends "" instead of a name
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
export async function fetchIcons(universeIds, { policy = BACKGROUND, trace = null } = {}) {
  const replies = await Promise.all(chunk(universeIds, ICONS_PER_REQUEST).map((ids) =>
    getJson("https://thumbnails.roblox.com/v1/games/icons?size=150x150&format=Webp"
      + `&isCircular=false&returnPolicy=PlaceHolder&universeIds=${ids.join(",")}`, policy, trace, "icons")));
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
