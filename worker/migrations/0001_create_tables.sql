-- Every game the tracker records.
CREATE TABLE games (
  universe_id    INTEGER PRIMARY KEY,         -- Roblox's ID for the whole game
  root_place_id  INTEGER,                     -- the number in the game's web address
  name           TEXT,                        -- current title (filled in on first collection)
  creator_name   TEXT,
  created_at     INTEGER,                     -- when the game was made on Roblox (unix seconds)
  last_updated   INTEGER,                     -- when the developer last published (unix seconds)
  tracked_since  INTEGER NOT NULL,            -- when WE started recording it (unix seconds)
  source         TEXT NOT NULL,               -- how it got here: 'seed', 'discovered' or 'search'
  active         INTEGER NOT NULL DEFAULT 1   -- 0 = no longer recorded (its history is kept)
);

-- The numbers for one game in one hour. This is the big table.
CREATE TABLE snapshots (
  universe_id  INTEGER NOT NULL,
  hour         INTEGER NOT NULL,   -- start of the hour (unix seconds), so all games line up
  playing      INTEGER,            -- players online
  visits       INTEGER,            -- total visits ever
  favorites    INTEGER,
  likes        INTEGER,
  dislikes     INTEGER,
  PRIMARY KEY (universe_id, hour)
) WITHOUT ROWID;

-- Things that happened to a game; these become the markers on the charts.
CREATE TABLE events (
  universe_id  INTEGER NOT NULL,
  at           INTEGER NOT NULL,   -- when it happened (unix seconds)
  kind         TEXT NOT NULL,      -- 'update' (developer published) or 'rename' (title changed)
  detail       TEXT,               -- for 'rename': the new title
  PRIMARY KEY (universe_id, at, kind)
) WITHOUT ROWID;

-- Small notes the tracker keeps about itself, e.g. when it last ran.
CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
