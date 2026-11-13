// Small database helpers shared by the other files.

/** The current time in unix seconds (seconds since 1 Jan 1970, UTC). */
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** A statement that saves a note in the meta table, replacing any old value. */
export function setMeta(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).bind(key, JSON.stringify(value));
}
