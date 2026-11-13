-- Genre is shown and filtered on the charts pages, so keep it with each game.
-- Existing games get it filled in the next time they're collected.
ALTER TABLE games ADD COLUMN genre TEXT;
