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
}

export interface OrderImpact {
  orders: Order[];
  currentAllocation: AllocationBreakdown[];
  projectedAllocation: AllocationBreakdown[];
  totalCurrentValue: number;
  totalProjectedValue: number;
}

