-- Daily summaries are now only made for days with at least 18 of their 24
-- hourly readings (MIN_READINGS_FOR_A_DAY in src/db.js). This removes the ones
-- already saved for days with fewer, so the daily charts don't show a
-- misleading average or peak for them:
--   - 15-17 Nov 2026, when the database's daily read limit was reached and
--     nothing was recorded from mid-morning to midnight;
--   - each game's first day, when it was only tracked for part of the day.
-- Their hourly readings are kept. Only days whose hourly readings still exist
-- (from 13 Nov 2026, when tracking began) are checked.
DELETE FROM daily
 WHERE day >= 1794528000  -- 13 Nov 2026, 00:00 UTC
   AND (SELECT COUNT(*) FROM snapshots s
         WHERE s.universe_id = daily.universe_id
           AND s.hour >= daily.day AND s.hour < daily.day + 86400) < 18;
