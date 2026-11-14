-- Each game's icon link, saved during the hourly collection. The charts can
-- then be built entirely inside the database, without asking Roblox for 1,500
-- icons at chart time.
ALTER TABLE games ADD COLUMN icon TEXT;

-- Start with the icons from the last saved charts, so the lists aren't missing
-- icons during the first hour (until every game has been collected once).
UPDATE games
   SET icon = (SELECT json_extract(chart.value, '$.icon')
                 FROM json_each((SELECT value FROM meta WHERE key = 'charts'), '$.games') AS chart
                WHERE json_extract(chart.value, '$.universeId') = games.universe_id)
 WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'charts');
