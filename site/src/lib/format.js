// Turning raw numbers and timestamps into friendly text.
// `undefined` as the locale means "use the visitor's own settings", so a
// visitor in the UK sees "13 Nov 2026" and their own time zone automatically.

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined);
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateAndTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const MISSING = "—";

/** 19638378371 -> "19.6B" */
export const formatCompact = (n) => (n == null ? MISSING : compact.format(n));

/** 19638378371 -> "19,638,378,371" */
export const formatNumber = (n) => (n == null ? MISSING : full.format(n));

/** 0.4567 -> "45.7%"; with signed: true -> "+45.7%" */
export function formatPercent(fraction, { signed = false } = {}) {
  if (fraction == null || !Number.isFinite(fraction)) return MISSING;
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(fraction);
}

/** Unix seconds -> "13 Nov 2026" */
export const formatDate = (unix) => (unix == null ? MISSING : dateOnly.format(unix * 1000));

/** Unix seconds -> "13 Nov 2026, 18:30" */
export const formatDateTime = (unix) => (unix == null ? MISSING : dateAndTime.format(unix * 1000));

const UNITS = [
  ["year", 31_536_000], ["month", 2_592_000], ["week", 604_800],
  ["day", 86_400], ["hour", 3_600], ["minute", 60],
];

/** Unix seconds -> "3 days ago", "in 2 hours", "just now" */
export function timeAgo(unix, nowMs = Date.now()) {
  if (unix == null) return MISSING;
  const seconds = unix - nowMs / 1000; // negative means the past
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Likes as a share of all votes: 900 likes, 100 dislikes -> 0.9 */
export function likeRatio(likes, dislikes) {
  const total = (likes ?? 0) + (dislikes ?? 0);
  return total > 0 ? likes / total : null;
}
