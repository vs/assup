/**
 * Iron Condor Builder types
 */

export type SpreadMode = "put-spread" | "call-spread" | "iron-condor";

/** Strategy modes for the unified options builder */
export type StrategyMode = "single" | "vertical" | "iron-condor";

export interface IronCondorChainOption {
  conId: number;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  delta: number;
  iv: number;
}

export interface IronCondorChainStrike {
  strike: number;
  put: IronCondorChainOption | null;
  call: IronCondorChainOption | null;
}

export interface IronCondorChainResponse {
  underlyingPrice: number;
  expirations: string[];
  selectedExpiration: string;
  chain: IronCondorChainStrike[];
}

export type IronCondorLegType = "PUT" | "CALL";
export type IronCondorLegSide = "BUY" | "SELL";

export interface IronCondorLeg {
  strike: number;
  type: IronCondorLegType;
  side: IronCondorLegSide;
  iv: number;
  bid: number;
  ask: number;
}

export interface IronCondorAnalyzeRequest {
  underlyingPrice: number;
  legs: IronCondorLeg[];
  daysToExpiry: number;
  quantity: number;
  mode: SpreadMode;
}

export interface IronCondorAnalyzeResponse {
  netCredit: { bid: number; ask: number; mid: number };
  maxProfit: number;
  maxLossPut: number | null;
  maxLossCall: number | null;
  breakEvenLow: number | null;
  breakEvenHigh: number | null;
  breakEvenLowPercent: number | null;
  breakEvenHighPercent: number | null;
  probabilityOfProfit: number;
  probabilityOfMaxLossPut: number | null;
  probabilityOfMaxLossCall: number | null;
  expectedValue: number;
  riskRewardRatio: number;
  payoffCurve: Array<{ price: number; pnl: number }>;
}

export interface IronCondorOrderLeg {
  conId: number;
  strike: number;
  type: IronCondorLegType;
  side: IronCondorLegSide;
  expiration: string;
  exchange: string;
}

export interface IronCondorOrderRequest {
  symbol: string;
  legs: IronCondorOrderLeg[];
  quantity: number;
  limitPrice: number;
}

export interface IronCondorOrderResponse {
  orderId: number;
  status: string;
}

/** Client-side state for selected spread legs */
export interface SpreadSelectedLegs {
  buyPut: number | null;
  sellPut: number | null;
  sellCall: number | null;
  buyCall: number | null;
}

/** @deprecated Use SpreadSelectedLegs */
export type IronCondorSelectedLegs = SpreadSelectedLegs;

/** A single leg of an active spread position */
export interface ActiveSpreadLeg {
  conId: number;
  strike: number;
  right: "P" | "C";
  side: "BUY" | "SELL";
  position: number;
  avgCost: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  midPrice: number | null;
  exchange: string;
}

/** An active spread/condor reconstructed from IBKR positions */
export interface ActiveSpread {
  id: string;
  type: SpreadMode;
  symbol: string;
  expiry: string;
  quantity: number;
  legs: ActiveSpreadLeg[];
  totalPnl: number | null;
  netPremium: number;
  closeMidPrice: number | null;
  orphanLegs: ActiveSpreadLeg[];
}

export type {
  SpreadStreamInitEvent,
  ChainUpdateEvent,
  PositionsUpdateEvent,
  StreamErrorEvent,
  RefocusedEvent,
  SpreadStreamEvent,
} from "./spreadStream.js";

/** Request to place a single-leg option order */
export interface SingleOrderRequest {
  symbol: string;
  conId: number;
  expiration: string;
  strike: number;
  right: "C" | "P";
  action: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
}

export interface SingleOrderResponse {
  orderId: number;
  status: string;
}

/** Hedge strategies available in the hedge wizard */
export type HedgeStrategy = "butterfly" | "protective" | "roll";

// --- Spread Strategy Advisor types ---

export interface StrategyFilter {
  name: string;
  passed: boolean;
  reason: string;
  value: number | null;
  threshold: number | null;
}

export interface SpreadStrategyMetrics {
  symbol: string;

  // Market data
  underlyingPrice: number | null;
  spotVix: number | null;
  vix3m: number | null;
  hv10: number | null;
  ivHvRatio: number | null;

  // Filters
  filters: StrategyFilter[];
  allFiltersPassed: boolean;

  // Recommendations
  dailyMovePct: number | null;
  recommendedShortStrike: number | null;
  recommendedLongStrike: number | null;
  wingWidth: number;
  positionMultiplier: number | null;

  // Cooloff state
  cooloffActive: boolean;
  cooloffUntil: string | null;
  lastLossDate: string | null;

  // Expiry guidance
  recommendedExpiry: "0DTE" | "1DTE" | null;

  // Timestamps
  computedAt: string;
}
