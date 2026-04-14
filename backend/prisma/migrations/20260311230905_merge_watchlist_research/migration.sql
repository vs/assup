-- Migration: merge_watchlist_research
-- Merges ResearchTicker into WatchlistItem, switches research tables to symbol-based references

-- Step 1: Add new columns to watchlist_items
ALTER TABLE "watchlist_items" ADD COLUMN "source" VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE "watchlist_items" ADD COLUMN "last_analyzed_at" TIMESTAMPTZ;
ALTER TABLE "watchlist_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Step 2: Add symbol column (nullable initially) to research tables
ALTER TABLE "data_collection" ADD COLUMN "symbol" VARCHAR(20);
ALTER TABLE "analysis" ADD COLUMN "symbol" VARCHAR(20);
ALTER TABLE "research_report" ADD COLUMN "symbol" VARCHAR(20);

-- Step 3: Populate symbol from research_ticker via JOIN
UPDATE "data_collection" dc SET "symbol" = rt."symbol" FROM "research_ticker" rt WHERE dc."ticker_id" = rt."id";
UPDATE "analysis" a SET "symbol" = rt."symbol" FROM "research_ticker" rt WHERE a."ticker_id" = rt."id";
UPDATE "research_report" rr SET "symbol" = rt."symbol" FROM "research_ticker" rt WHERE rr."ticker_id" = rt."id";

-- Step 4: Migrate research tickers not already in any watchlist into a "Migrated Research" watchlist
-- Only creates the watchlist if there are orphan tickers
DO $$
DECLARE
  migrated_watchlist_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "research_ticker" rt
    WHERE NOT EXISTS (
      SELECT 1 FROM "watchlist_items" wi WHERE wi."symbol" = rt."symbol"
    )
  ) THEN
    INSERT INTO "watchlists" ("id", "name", "created_at", "updated_at")
    VALUES (gen_random_uuid(), 'Migrated Research', NOW(), NOW())
    RETURNING "id" INTO migrated_watchlist_id;

    INSERT INTO "watchlist_items" ("id", "watchlist_id", "symbol", "sec_type", "added_at", "source", "sort_order")
    SELECT gen_random_uuid(), migrated_watchlist_id, rt."symbol", rt."sec_type", rt."added_at", rt."source", 0
    FROM "research_ticker" rt
    WHERE NOT EXISTS (
      SELECT 1 FROM "watchlist_items" wi WHERE wi."symbol" = rt."symbol"
    );
  END IF;
END $$;

-- Step 5: Copy last_analyzed from research_ticker to matching watchlist_items
UPDATE "watchlist_items" wi
SET "last_analyzed_at" = rt."last_analyzed"
FROM "research_ticker" rt
WHERE wi."symbol" = rt."symbol" AND rt."last_analyzed" IS NOT NULL;

-- Step 6: Add watchlist_id column to scan_runs
ALTER TABLE "scan_runs" ADD COLUMN "watchlist_id" UUID;

-- Step 7: Drop old FK constraints and indexes
ALTER TABLE "data_collection" DROP CONSTRAINT "data_collection_ticker_id_fkey";
ALTER TABLE "analysis" DROP CONSTRAINT "analysis_ticker_id_fkey";
ALTER TABLE "research_report" DROP CONSTRAINT "research_report_ticker_id_fkey";

DROP INDEX "data_collection_ticker_id_source_idx";
DROP INDEX "analysis_ticker_id_source_idx";
DROP INDEX "research_report_ticker_id_idx";

-- Step 8: Drop old ticker_id columns
ALTER TABLE "data_collection" DROP COLUMN "ticker_id";
ALTER TABLE "analysis" DROP COLUMN "ticker_id";
ALTER TABLE "research_report" DROP COLUMN "ticker_id";

-- Step 9: Make symbol NOT NULL now that all rows are populated
ALTER TABLE "data_collection" ALTER COLUMN "symbol" SET NOT NULL;
ALTER TABLE "analysis" ALTER COLUMN "symbol" SET NOT NULL;
ALTER TABLE "research_report" ALTER COLUMN "symbol" SET NOT NULL;

-- Step 10: Drop research_ticker table
DROP TABLE "research_ticker";

-- Step 11: Add new indexes
CREATE INDEX "data_collection_symbol_source_idx" ON "data_collection"("symbol", "source");
CREATE INDEX "analysis_symbol_source_idx" ON "analysis"("symbol", "source");
CREATE INDEX "research_report_symbol_idx" ON "research_report"("symbol");

-- Step 12: Add FK constraint for scan_runs -> watchlists
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_watchlist_id_fkey"
  FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
