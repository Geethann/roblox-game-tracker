-- One summary row per game per day, kept forever. Built each night from the
-- hourly rows, so long ranges (90d, 1Y, All) load quickly and hourly rows can
-- be deleted after 90 days without losing the long-term picture.
CREATE TABLE daily (
  universe_id   INTEGER NOT NULL,
  day           INTEGER NOT NULL,   -- midnight UTC at the start of the day (unix seconds)
  avg_playing   INTEGER,            -- average players online across the day
  peak_playing  INTEGER,            -- most players online in any hour that day
  visits        INTEGER,            -- the rest are end-of-day totals
  favorites     INTEGER,
  likes         INTEGER,
  dislikes      INTEGER,
  PRIMARY KEY (universe_id, day)
) WITHOUT ROWID;
