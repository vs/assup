-- Increase column sizes for imported_trades to handle longer option symbols
ALTER TABLE "imported_trades" ALTER COLUMN "trade_id" TYPE VARCHAR(100);
ALTER TABLE "imported_trades" ALTER COLUMN "symbol" TYPE VARCHAR(50);
ALTER TABLE "imported_trades" ALTER COLUMN "underlying" TYPE VARCHAR(50);
