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
    | "SOLD_SHARES"
    | "BOUGHT_SHARES"
    | "EXPIRED";
  strike: number | null;
  expiry: string | null;
  quantity: number;
  premium: number; // positive = received, negative = paid
  commission: number;
  isWheelTrade: boolean; // false for non-wheel trades like bought options
  runningCostBasis: number; // cost basis per share after this trade
}

// Matched trade with open/close legs for display
export interface WheelMatchedTrade {
  id: string;
  type: "OPTION" | "STOCK";

  // Summary (for collapsed row)
  displayName: string;        // "TLT Jan30'26 89 PUT" or "100 AAPL"
  status: "open" | "closed" | "expired" | "assigned" | "called_away";
  netPnL: number | null;      // null if still open

  // Legs (for expanded view)
  openLeg: {
    date: string;
    action: string;           // "Sold PUT", "Bought 100 shares"
    price: number;            // per-share/contract price
    quantity: number;
    total: number;            // gross amount
  } | null;

  closeLeg: {
    date: string;
    action: string;           // "Bought back", "Sold", "Expired", "Assigned"
    price: number | null;     // null if expired worthless
    quantity: number;
    total: number;
  } | null;
}

// A complete wheel cycle (any period with non-zero position)
export interface WheelCycle {
  cycleNumber: number;
  startDate: string;
  endDate: string | null;
  status: "in_progress" | "called_away" | "sold_shares" | "expired_worthless";
  totalPremium: number;
  shareQuantity: number;
  entryStrike: number; // first CSP strike or buy price
  exitPrice: number | null; // price when called away or sold
  roc: number; // return on capital %
  annualizedRoc: number;
  durationDays: number;
  trades: WheelMatchedTrade[];
  // New fields for clarity
  entryType: "sold_put" | "bought_shares" | "assigned";
  entryDescription: string; // "Sold PUT $145" or "Bought 100 @ $148"
  exitType: "called_away" | "sold_shares" | "put_expired" | "cc_expired" | "in_progress";
  exitDescription: string | null; // "Called away @ $150" or null if in progress
  // P&L fields
  realizedPnL: number;
  unrealizedPnL: number | null; // null if cycle complete
  capitalDeployed: number;
  pnlPercent: number | null;
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
  // P&L fields
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  capitalDeployed: number;
  realizedPnLPercent: number | null;
  unrealizedPnLPercent: number | null;
  totalPnLPercent: number | null;
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
  hasActivePosition: boolean;
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
  // P&L fields
  totalRealizedPnL: number;
  totalUnrealizedPnL: number;
  totalPnL: number;
  totalPnLPercent: number | null;
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
