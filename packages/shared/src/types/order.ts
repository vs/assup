/**
 * Order types for open orders and impact analysis
 */

import type { OptionRight } from "./position.js";
import type { AllocationBreakdown } from "./allocation.js";

export interface Order {
  orderId: number;
  symbol: string;
  displayName: string;
  conId: number;
  secType: string;
  right?: OptionRight;
  action: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  limitPrice?: number;
  status: string;
  filledQuantity: number;
  avgFillPrice: number;
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
  estimatedValue?: number;
  bid?: number;
  ask?: number;
}

export interface OrderImpact {
  orders: Order[];
  currentAllocation: AllocationBreakdown[];
  projectedAllocation: AllocationBreakdown[];
  totalCurrentValue: number;
  totalProjectedValue: number;
}

/**
 * Input for placing a new order
 */
export interface PlaceOrderInput {
  symbol: string;
  expiration: string;     // YYYYMMDD format
  strike: number;
  right: "C" | "P";       // Call or Put
  action: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
  tif?: "DAY" | "GTC";
  /** Override trading class (e.g. "XSPW" for XSP options listed under SPX) */
  tradingClass?: string;
}

/**
 * Response from placing an order
 */
export interface PlaceOrderResult {
  orderId: number;
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
}

/**
 * Input for modifying an existing order
 */
export interface ModifyOrderInput {
  orderId: number;
  limitPrice: number;
  quantity: number;
  tif?: "DAY" | "GTC";
}

/**
 * Response from modifying an order
 */
export interface ModifyOrderResult {
  orderId: number;
  limitPrice: number;
  quantity: number;
}

/**
 * Response from an option quote request
 */
export interface OptionQuoteResult {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
}
