-- Fix commission sign convention: IBKR stores commission as negative (cost),
-- but the import was applying Math.abs() making them positive.
-- The trade matching code expects negative commission values.
-- Negate all non-zero commissions to restore the correct IBKR sign convention.
UPDATE imported_trades SET commission = -commission WHERE commission != 0;
