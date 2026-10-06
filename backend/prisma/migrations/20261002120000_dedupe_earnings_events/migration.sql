-- Earnings rows are keyed by symbol and announcement date, so every time
-- Finnhub moved a date the sync left the old row behind. The sync now removes
-- those itself, but only for quarters still inside its fetch window; this
-- clears the backlog. Keep the most recently synced row per symbol and quarter.
DELETE FROM "calendar_event"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "symbol", "details"->>'quarter'
        ORDER BY "updated_at" DESC, "date" DESC
      ) AS rn
    FROM "calendar_event"
    WHERE "source" = 'finnhub'
      AND "event_type" = 'EARNINGS'
      AND "details"->>'quarter' IS NOT NULL
  ) ranked
  WHERE rn > 1
);
