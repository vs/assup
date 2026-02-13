/**
 * Wheel strategy tracking types
 */

// Wheel tracker record (database model)
export interface WheelTracker {
  id: string;
  symbol: string;
  startDate: string | null;
  createdAt: string;
}

// Individual trade within a wheel cycle
export interface WheelTrade {
  id: string;
  tradeDate: string;
  type:
    | "SOLD_PUT"
    | "ASSIGNED"
    | "SOLD_CALL"
    | "BOUGHT_PUT"
    | "BOUGHT_CALL"
    | "CALLED_AWAY"
    | "SOLD_SHARES";
  strike: number | null;
  expiry: string | null;
  quantity: number;
  premium: number; // positive = received, negative = paid
  commission: number;
  isWheelTrade: boolean; // false for non-wheel trades like bought options
  runningCostBasis: number; // cost basis per share after this trade
}

// A complete wheel cycle (CSP -> assignment -> covered calls -> exit)
export interface WheelCycle {
  cycleNumber: number;
  startDate: string;
  endDate: string | null;
  status: "in_progress" | "called_away" | "sold_shares";
  totalPremium: number;
  shareQuantity: number;
  entryStrike: number; // first CSP strike
  exitPrice: number | null; // price when called away or sold
  roc: number; // return on capital %
  annualizedRoc: number;
  durationDays: number;
  trades: WheelTrade[];
}

// Summary view of a ticker in the wheel tracker list
export interface WheelTickerSummary {
  symbol: string;
  currentPhase: "csp_open" | "holding_shares" | "cc_open" | "idle";
  adjustedCostBasis: number; // per share
  totalPremiums: number;
  currentPrice: number | null;
  breakEven: number;
  percentBelowMarket: number | null;
  cycleCount: number;
  completedCycles: number;
  currentPosition: {
    type: "csp" | "shares" | "cc" | null;
    strike?: number;
    expiry?: string;
    dte?: number;
    quantity: number;
    premium?: number;
    unrealizedPnl?: number;
  } | null;
}

// Detailed view of a ticker including all cycles
export interface WheelTickerDetail extends WheelTickerSummary {
  cycles: WheelCycle[];
}

// Suggestion for adding a ticker to wheel tracking
export interface WheelSuggestion {
  symbol: string;
  putCount: number;
  callCount: number;
  totalPremium: number;
  lastTradeDate: string;
  firstTradeDate: string;
}

// Aggregate metrics across all tracked wheels
export interface WheelAggregateMetrics {
  capitalDeployed: number;
  totalPremiums: number;
  premiumYieldAnnualized: number;
  vsBuyAndHold: number;
  trackedCount: number;
  activeWheels: number;
  completedCycles: number;
}

// Response for wheel tracker list endpoint
export interface WheelListResponse {
  tickers: WheelTickerSummary[];
  metrics: WheelAggregateMetrics;
}

// Response for wheel suggestions endpoint
export interface WheelSuggestionsResponse {
  suggestions: WheelSuggestion[];
}
