-- AlterTable: widen sector and market_position columns
ALTER TABLE "ticker_profile" ALTER COLUMN "sector" TYPE VARCHAR(255);
ALTER TABLE "ticker_profile" ALTER COLUMN "market_position" TYPE TEXT;
