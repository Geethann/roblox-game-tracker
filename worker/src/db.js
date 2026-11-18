// Small database helpers shared by the other files.

/** The current time in unix seconds (seconds since 1 Jan 1970, UTC). */
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * A day only gets a daily summary (average, peak, end-of-day totals) if it has
 * at least this many of its 24 hourly readings. A day with only a morning's
 * readings (an outage, or the day a game started being tracked) would give a
 * misleading average and peak, so it's left out of the daily charts instead.
 */
export const MIN_READINGS_FOR_A_DAY = 18;

/** A statement that saves a note in the meta table, replacing any old value. */
export function setMeta(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).bind(key, JSON.stringify(value));
}
