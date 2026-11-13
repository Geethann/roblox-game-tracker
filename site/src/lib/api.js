// Everything that talks to our backend API lives here. Each "use..." function
// is a React hook: a component calls it and gets { data, isPending, error }.
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL
  ?? "https://roblox-game-tracker.roblox-game-tracker-worker.workers.dev";

/** An error from our API, with the HTTP status (0 = couldn't connect at all). */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function getJson(path) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`);
  } catch {
    throw new ApiError("Can't reach the tracker. Check your connection and try again.", 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error ?? `Something went wrong (error ${response.status}).`, response.status);
  }
  return body;
}

/** Search any Roblox game by name. Only searches once there are 2+ characters. */
export function useSearch(query) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search", q.toLowerCase()],
    queryFn: () => getJson(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData, // keep showing the last results while new ones load
  });
}

// The settings for one game's details / history. Shared by the single-game
// hooks and the many-games hooks, so they share the same saved copies:
// opening a comparison doesn't re-download a game you just looked at.
const gameQuery = (universeId) => ({
  queryKey: ["game", String(universeId)],
  queryFn: () => getJson(`/api/games/${universeId}`),
  enabled: Boolean(universeId),
  refetchInterval: 60_000,
});

const historyQuery = (universeId, range) => ({
  queryKey: ["history", String(universeId), range],
  queryFn: () => getJson(`/api/games/${universeId}/history?range=${range}`),
  enabled: Boolean(universeId),
  staleTime: 5 * 60_000,
  refetchInterval: 10 * 60_000,
});

/** One game's details and live numbers, refreshed every minute. */
export function useGame(universeId) {
  return useQuery(gameQuery(universeId));
}

/** Several games' details at once (one request each, sent together). */
export function useGames(universeIds) {
  return useQueries({ queries: universeIds.map(gameQuery) });
}

/** Several games' chart data for the same range. */
export function useHistories(universeIds, range) {
  return useQueries({
    queries: universeIds.map((id) => ({ ...historyQuery(id, range), placeholderData: keepPreviousData })),
  });
}

/** A game's chart data for one range (24h, 7d ... all). New readings arrive hourly. */
export function useHistory(universeId, range) {
  return useQuery({
    ...historyQuery(universeId, range),
    placeholderData: keepPreviousData, // keep the old chart (faded) while a new range loads
  });
}

/** Every tracked game's latest numbers, for the full chart tables. Rebuilt hourly by the backend. */
export function useCharts() {
  return useQuery({
    queryKey: ["charts"],
    queryFn: () => getJson("/api/charts"),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}

/** The home page lists, refreshed every 5 minutes. */
export function useLeaderboards() {
  return useQuery({
    queryKey: ["leaderboards"],
    queryFn: () => getJson("/api/leaderboards"),
    refetchInterval: 5 * 60_000,
  });
}
