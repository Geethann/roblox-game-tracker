// Comparing games: reading the choice from the address, keeping each game's
// colour steady, and joining several histories into one chart.
import { useState } from "react";

export const MAX_OTHERS = 4; // your main game + up to 4 others = 5 lines, the most a chart reads clearly
export const SLOTS = 5;      // --series-1 ... --series-5 in styles.css

/** "123,456,abc,123" -> [123, 456]: digits only, no repeats, at most `limit`, never `without`. */
export function parseIds(text, { without = null, limit = MAX_OTHERS } = {}) {
  const ids = (text ?? "").split(",").filter((part) => /^\d{1,15}$/.test(part)).map(Number);
  return [...new Set(ids)].filter((id) => id !== without).slice(0, limit);
}

/**
 * Gives each game a colour slot (1-5) and keeps it while the page is open.
 * Removing one game must not repaint the others: a reader who has learnt
 * "Brookhaven is orange" would otherwise be misled. A newly added game takes
 * the lowest free slot.
 */
export function useStableSlots(ids) {
  const key = ids.join(",");
  const [saved, setSaved] = useState(() => ({ key, slots: assignSlots(new Map(), ids) }));
  // The games changed: work out the new slots from the old ones. Updating
  // state while drawing like this is React's recommended way to "adjust state
  // when the inputs change" (it redraws straight away, before showing anything).
  if (saved.key !== key) {
    const next = { key, slots: assignSlots(saved.slots, ids) };
    setSaved(next);
    return next.slots;
  }
  return saved.slots;
}

/** Keep the slots of games still present; give new games the lowest free slot. */
export function assignSlots(previous, ids) {
  const slots = new Map([...previous].filter(([id]) => ids.includes(id))); // forget removed games
  for (const id of ids) {
    if (!slots.has(id)) {
      const used = new Set(slots.values());
      slots.set(id, Array.from({ length: SLOTS }, (_, i) => i + 1).find((slot) => !used.has(slot)) ?? 1);
    }
  }
  return slots;
}

/**
 * Joins several games' points into chart rows: [{ t, 123: value, 456: value }].
 * mode "percent": each game's change since its first reading in the range,
 * so games of very different sizes can share one scale fairly.
 */
export function mergeSeries(series, valueOf, mode) {
  const rows = new Map();
  for (const { id, points } of series) {
    const first = points.map(valueOf).find((v) => v != null && v !== 0);
    for (const point of points) {
      const raw = valueOf(point);
      const value = raw == null ? null
        : mode === "percent" ? (first ? raw / first - 1 : null)
        : raw;
      if (!rows.has(point.t)) rows.set(point.t, { t: point.t });
      rows.get(point.t)[id] = value;
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

/**
 * A game name made safe for a CSV cell: wrapped in quotes (names can contain
 * commas), and a leading = + - @ neutralised, because spreadsheet apps would
 * otherwise run a name like "=HYPERLINK(...)" as a formula ("CSV injection").
 */
function csvName(name) {
  const safe = /^[=+\-@]/.test(name) ? `'${name}` : name;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** A comparison table of the chart: one column per game. */
export function toCompareCsv(rows, games, resolution) {
  const header = [resolution === "day" ? "date_utc" : "time_utc", ...games.map((g) => csvName(g.name))];
  const lines = rows.map((row) => [
    new Date(row.t * 1000).toISOString().slice(0, resolution === "day" ? 10 : 16).replace("T", " "),
    ...games.map((g) => row[g.universeId] ?? ""),
  ]);
  return [header, ...lines].map((line) => line.join(",")).join("\n");
}

/** How many times main's players: 3.2× (more than main) or 0.31× (fewer). */
export function playersVsMain(players, mainPlayers) {
  if (players == null || !mainPlayers) return "—";
  const ratio = players / mainPlayers;
  const digits = ratio >= 10 ? 0 : ratio >= 1 ? 1 : 2;
  return `${ratio.toFixed(digits)}×`;
}

/** Rating difference from main in percentage points: "+1.4 pts", "-0.8 pts" or "Same". */
export function ratingVsMain(rating, mainRating) {
  if (rating == null || mainRating == null) return "—";
  const points = Math.round((rating - mainRating) * 1000) / 10;
  return points === 0 ? "Same" : `${points > 0 ? "+" : ""}${points} pts`;
}
