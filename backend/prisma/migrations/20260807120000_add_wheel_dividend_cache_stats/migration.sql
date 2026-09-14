-- Wheel summary cache must also invalidate when dividends change, not just trades.
ALTER TABLE "wheel_summary_cache" ADD COLUMN "dividend_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "wheel_summary_cache" ADD COLUMN "last_dividend_date" DATE;
