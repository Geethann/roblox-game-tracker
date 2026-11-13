// Turning the API's raw history into what the chart, cards and CSV need.
// No React here: just plain functions, which keeps them easy to test.
import { formatCompact, formatNumber, formatPercent, likeRatio } from "./format.js";

/** The range buttons, in order. `days` is only used for labels. */
export const RANGES = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];
export const DEFAULT_RANGE = "7d";
export const isRange = (key) => RANGES.some((r) => r.key === key);

/**
 * The four things the chart can show. Each says how to read its value from a
 * point, how to format it, and how the chart's scale should behave.
 *   - Amounts (players, visits/favourites gained) start at zero, so a point
 *     twice as high really means twice as many.
 *   - The rating is a percentage that changes slowly, so the chart zooms in,
 *     but never to less than a 2-point span (`minSpan`): otherwise a 0.01%
 *     wobble would look like a dramatic crash.
 * Visits and favourites are charted as "gained per hour/day" rather than as
 * running totals: a total of 3.3 million that grows by a few thousand is a flat
 * line, while the amount gained shows what actually changed.
 */
export const METRICS = {
  players: {
    label: "Players",
    title: (res) => (res === "day" ? "Average players online per day" : "Players online"),
    value: (p) => p.playing,
    format: formatNumber,
    axis: formatCompact,
    fromZero: true,
  },
  visits: {
    label: "Visits",
    title: (res) => (res === "day" ? "New visits per day" : "New visits per hour"),
    value: (p) => p.visitsGained,
    format: formatNumber,
    axis: formatCompact,
    fromZero: true,
  },
  favorites: {
    label: "Favourites",
    title: (res) => (res === "day" ? "New favourites per day" : "New favourites per hour"),
    value: (p) => p.favoritesGained,
    format: formatNumber,
    axis: formatCompact,
    fromZero: true,
  },
  rating: {
    label: "Rating",
    title: () => "Rating (likes as a share of all votes)",
    value: (p) => p.rating,
    format: (v) => formatPercent(v),
    axis: (v) => formatPercent(v),
    fromZero: false,
    minSpan: 0.02, // 2 percentage points
    limits: [0, 1],
  },
};

/**
 * The chart's vertical scale for a measure and its values:
 * { domain: [bottom, top], ticks } - ticks only when we choose them ourselves.
 */
export function valueScale(metric, values) {
  const present = values.filter((v) => v != null);
  if (present.length === 0) return { domain: [0, 1] };
  const low = Math.min(...present);
  const high = Math.max(...present);
  // Amounts: start at zero (or lower, so dips below zero stay visible); Recharts picks the ticks.
  if (metric.fromZero) return { domain: [Math.min(0, low), "auto"] };

  // Zoomed-in measures: at least `minSpan` tall, with labels on round steps.
  const span = Math.max(high - low, metric.minSpan ?? 0);
  const middle = (low + high) / 2;
  const step = niceStep(span / 4);
  let bottom = Math.floor((middle - span / 2) / step) * step;
  let top = Math.ceil((middle + span / 2) / step) * step;
  if (metric.limits) {
    bottom = Math.max(bottom, metric.limits[0]);
    top = Math.min(top, metric.limits[1]);
  }
  const ticks = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return { domain: [bottom, top], ticks };
}

/** Rounds a step size up to a "nice" number: 1, 2, 2.5 or 5 × a power of ten. */
function niceStep(rough) {
  const power = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough);
}
export const isMetric = (key) => Object.hasOwn(METRICS, key);

/**
 * Adds the values the API doesn't send directly:
 *   visitsGained, favoritesGained - change since the previous reading, only if
 *                  it's exactly one hour/day earlier (after a gap we don't guess)
 *   rating       - likes ÷ (likes + dislikes)
 *   partial      - true for today in daily view: the day isn't over, so its
 *                  "gained" figures are left out rather than shown as a fake drop
 */
export function preparePoints(points, resolution, nowSeconds = Date.now() / 1000) {
  const step = resolution === "day" ? 86_400 : 3_600;
  return points.map((point, i) => {
    const previous = points[i - 1];
    const partial = resolution === "day" && point.t + step > nowSeconds;
    const usable = previous && point.t - previous.t === step && !partial;
    const gained = (key) => (usable && point[key] != null && previous[key] != null ? point[key] - previous[key] : null);
    const visits = gained("visits");
    return {
      ...point,
      partial,
      visitsGained: visits == null ? null : Math.max(0, visits), // visits never go down
      favoritesGained: gained("favorites"),                   // can go down (unfavourites)
      rating: likeRatio(point.likes, point.dislikes),
    };
  });
}

/** The numbers for the stat cards, worked out over the whole chosen range. */
export function summarise(points) {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const players = points.map((p) => p.peak ?? p.playing).filter((v) => v != null);
  const peakValue = players.length ? Math.max(...players) : null;
  const peakPoint = points.find((p) => (p.peak ?? p.playing) === peakValue);
  // A change needs two readings to compare; with one, there's nothing to measure yet.
  if (points.length < 2) {
    return { peak: peakValue, peakAt: peakPoint?.t ?? null, from: first.t, to: last.t };
  }
  return {
    peak: peakValue,
    peakAt: peakPoint?.t ?? null,
    visitsGained: diff(first.visits, last.visits),
    favoritesGained: diff(first.favorites, last.favorites),
    favoritesChange: ratioChange(first.favorites, last.favorites),
    ratingChange: diff(first.rating, last.rating), // in percentage points
    from: first.t,
    to: last.t,
  };
}

const diff = (a, b) => (a == null || b == null ? null : b - a);
const ratioChange = (a, b) => (a ? (b - a) / a : null);

// ---- Time axis labels ----------------------------------------------------------
//
// Labels go on whole hours / days / months in the visitor's own time zone
// (e.g. 12:00, 15:00, 18:00 - never 13:27). We try steps from small to large
// and use the first that fits at most `maxTicks` labels.

const STEPS = [
  ["hour", 1], ["hour", 3], ["hour", 6], ["hour", 12],
  ["day", 1], ["day", 2], ["day", 7], ["day", 14],
  ["month", 1], ["month", 3], ["month", 6], ["year", 1],
];

export function timeTicks(minT, maxT, maxTicks = 7) {
  for (const [unit, n] of STEPS) {
    const d = new Date(minT * 1000);
    if (unit === "hour") { d.setMinutes(0, 0, 0); d.setHours(d.getHours() - (d.getHours() % n)); }
    else if (unit === "day") d.setHours(0, 0, 0, 0);
    else if (unit === "month") { d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() - (d.getMonth() % n)); }
    else { d.setHours(0, 0, 0, 0); d.setMonth(0, 1); }

    const ticks = [];
    while (d.getTime() / 1000 <= maxT && ticks.length <= maxTicks) {
      if (d.getTime() / 1000 >= minT) ticks.push(d.getTime() / 1000);
      if (unit === "hour") d.setHours(d.getHours() + n);
      else if (unit === "day") d.setDate(d.getDate() + n);
      else if (unit === "month") d.setMonth(d.getMonth() + n);
      else d.setFullYear(d.getFullYear() + 1);
    }
    if (ticks.length <= maxTicks) return { ticks, unit };
  }
  return { ticks: [], unit: "year" };
}

const fmt = (options) => new Intl.DateTimeFormat(undefined, options);
const TICK_FORMATS = {
  time: fmt({ hour: "2-digit", minute: "2-digit" }),
  day: fmt({ day: "numeric", month: "short" }),
  month: fmt({ month: "short", year: "2-digit" }),
  year: fmt({ year: "numeric" }),
};

/** The text under one tick, e.g. "15:00", "13 Nov", "Nov 26", "2026". */
export function formatTick(t, unit) {
  const date = new Date(t * 1000);
  if (unit === "hour") {
    // Midnight gets the date instead, so you can see where each day starts.
    return date.getHours() === 0 ? TICK_FORMATS.day.format(date) : TICK_FORMATS.time.format(date);
  }
  return TICK_FORMATS[unit].format(date);
}

const TOOLTIP_FORMATS = {
  hour: fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  day: fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" }),
};

/** The date at the top of the hover box, e.g. "Fri 13 Nov, 18:00" or "Fri 13 Nov 2026 (so far)". */
export const formatPointTime = (t, resolution, partial = false) =>
  TOOLTIP_FORMATS[resolution].format(t * 1000) + (partial ? " (so far)" : "");

/** When a range starts (unix seconds), matching how the API works it out. */
export function rangeStart(rangeKey, nowMs = Date.now()) {
  const range = RANGES.find((r) => r.key === rangeKey);
  if (range?.days) return nowMs / 1000 - range.days * 86_400;
  if (rangeKey === "ytd") return Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1) / 1000;
  return 0; // "all"
}

/** A CSV file (opens in Excel / Google Sheets) of exactly what's on the chart. */
export function toCsv(points, resolution) {
  const header = resolution === "day"
    ? ["date_utc", "avg_players", "peak_players_hourly", "visits", "visits_gained", "favourites", "favourites_gained", "likes", "dislikes"]
    : ["time_utc", "players", "visits", "visits_gained", "favourites", "favourites_gained", "likes", "dislikes"];
  const rows = points.map((p) => {
    const time = new Date(p.t * 1000).toISOString().slice(0, resolution === "day" ? 10 : 16).replace("T", " ");
    return resolution === "day"
      ? [time, p.playing, p.peak, p.visits, p.visitsGained, p.favorites, p.favoritesGained, p.likes, p.dislikes]
      : [time, p.playing, p.visits, p.visitsGained, p.favorites, p.favoritesGained, p.likes, p.dislikes];
  });
  return [header, ...rows].map((row) => row.map((v) => v ?? "").join(",")).join("\n");
}

/** Make the browser download some text as a file. */
export function downloadFile(filename, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // free the memory once the download has started
}

/** "[🎃] Jujutsu Shenanigans" -> "jujutsu-shenanigans" (safe for a file name) */
export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game";
}
