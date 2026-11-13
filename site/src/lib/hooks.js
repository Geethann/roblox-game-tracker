// Small reusable React hooks.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/** Returns `value`, but only after it has stopped changing for `delayMs`.
 *  Used by search, so we don't send a request for every key press. */
export function useDebounced(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer); // typed again before the delay? cancel and restart
  }, [value, delayMs]);
  return debounced;
}

/** The current time, updated every `intervalMs`, so "2 minutes ago" labels keep ticking. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// ---- Remembering things in this browser (localStorage) --------------------------
//
// localStorage can be blocked (private browsing, strict privacy settings), so
// every access is wrapped in try/catch and falls back to memory: the site keeps
// working, it just forgets when the tab closes.

const memory = new Map();
const listeners = new Set();

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key, raw) {
  try {
    localStorage.setItem(key, raw);
  } catch {
    memory.set(key, raw);
  }
  listeners.forEach((notify) => notify()); // tell every component using it
}

function subscribe(notify) {
  listeners.add(notify);
  window.addEventListener("storage", notify); // changes made in other tabs
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/**
 * Like useState, but saved in the browser and shared by every component
 * (and tab) that uses the same key. The setter also accepts a function:
 * setValue((old) => newValue).
 */
export function useStoredValue(key, fallback) {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key));
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }, [raw]); // `fallback` is left out on purpose: callers always pass a constant

  const setValue = useCallback((next) => {
    const current = (() => {
      try {
        return JSON.parse(readRaw(key)) ?? fallback;
      } catch {
        return fallback;
      }
    })();
    const resolved = typeof next === "function" ? next(current) : next;
    writeRaw(key, JSON.stringify(resolved));
  }, [key]); // `fallback` is left out on purpose: callers always pass a constant

  return [value, setValue];
}

const NO_GAMES = [];

/** The visitor's chosen main game: { universeId, name, icon } or null. */
export function useMainGame() {
  return useStoredValue("mainGame", null);
}

/** Games the visitor recently opened (newest first, up to 6), plus a function to add one. */
export function useRecentGames() {
  const [recent, setRecent] = useStoredValue("recentGames", NO_GAMES);
  const remember = useCallback((game) => {
    setRecent((old) => [game, ...old.filter((g) => g.universeId !== game.universeId)].slice(0, 6));
  }, [setRecent]);
  return [recent, remember];
}
