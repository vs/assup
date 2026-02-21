/**
 * Shared trade matching utilities for grouping open/close trades
 * Used by both profit.service.ts and wheel.service.ts
 */

import type { OptionTradeGroup, StockTradeGroup, OptionTradeDetail, StockTradeDetail } from "@assup/shared";

// Input trade type for option grouping
export interface OptionTradeInput {
  id: string;
  tradeId: string;
  symbol: string;
  description: string | null;
  conId: number | null;
  strike: number | null;
  expiry: Date | null;
  right: string | null;
  underlying: string | null;
  tradeDate: Date;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  openClose: string | null;
  wasAssigned: boolean;
  costBasis: number | null;
  realizedPnl: number | null;
}

// Input trade type for stock grouping
export interface StockTradeInput {
  id: string;
  tradeId: string;
  symbol: string;
  tradeDate: Date;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  openClose: string | null;
  costBasis: number | null;
  realizedPnl: number | null;
}

// Asset class mapping type
export type AssetClassMap = Map<string, {
  assetClassId: string;
  assetClassName: string;
  assetClassColor: string;
}>;

/**
 * Check if an expiry date has passed (is before today, not including today).
 */
export function hasExpiryPassed(expiryDate: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return expiry < today;
}
