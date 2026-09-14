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

/** A spread (2-leg structure) detected within a wheel cycle */
export interface WheelSpreadGroup {
  type: "call-credit" | "call-debit" | "put-credit" | "put-debit";
  shortLeg: WheelMatchedTrade;
  longLeg: WheelMatchedTrade;
  netPremium: number;
  maxLoss: number;
  currentPnl: number | null;
  expiry: string;
  dte: number;
}

/** A dividend payment attributed to a wheel cycle, net of withholding tax */
export interface WheelDividend {
  /** Stable id: `${symbol}-${payDate}` */
  id: string;
  /** IBKR pay date, YYYY-MM-DD */
  payDate: string;
  /** Dividend rate per share as declared by IBKR */
  perShare: number;
  /** Shares of this cycle the payment was credited against */
  shares: number;
  /** Gross dividend attributed to this cycle (USD) */
  gross: number;
  /** Withholding tax attributed to this cycle (USD, negative) */
  withholdingTax: number;
  /** gross + withholdingTax — the cash actually kept */
  net: number;
}

// A complete wheel cycle (any period with non-zero position)
export interface WheelCycle {
  cycleNumber: number;
  startDate: string;
  endDate: string | null;
  status: "in_progress" | "called_away" | "sold_shares" | "expired_worthless" | "closed";
  totalPremium: number;
  /** Net premiums from covered calls collected AFTER shares were assigned (not embedded in IBKR's avgCost) */
  postAssignmentPremium: number;
  shareQuantity: number;
  entryStrike: number; // first CSP strike or buy price
  exitPrice: number | null; // price when called away or sold
  roc: number; // return on capital %
  annualizedRoc: number;
  durationDays: number;
  trades: WheelMatchedTrade[];
  /** Spread groups detected from paired option legs */
  spreadGroups: WheelSpreadGroup[];
  /** Dividends earned while this cycle held shares, net of withholding tax */
  dividends: WheelDividend[];
  /** Sum of `dividends[].net` — included in realizedPnL and roc */
  dividendIncome: number;
  // New fields for clarity
  entryType: "sold_put" | "bought_shares" | "assigned" | "sold_call";
  entryDescription: string; // "Sold PUT $145" or "Bought 100 @ $148"
  exitType: "called_away" | "sold_shares" | "put_expired" | "cc_expired" | "put_closed" | "cc_closed" | "in_progress";
  exitDescription: string | null; // "Called away @ $150" or null if in progress
  // P&L fields
  realizedPnL: number;
  unrealizedPnL: number | null; // null if cycle complete
  capitalDeployed: number;
  pnlPercent: number | null;
}

/** Individual live IBKR position for the wheel detail view */
export interface WheelLivePosition {
  type: "shares" | "put" | "call" | "put-spread" | "call-spread";
  strike?: number;
  expiry?: string;
  dte?: number;
  quantity: number;
  /** Per-share avg cost */
  avgCost: number;
  /** Current market price per share */
  marketPrice: number | null;
  /** Total unrealized P&L */
  pnl: number | null;
  /** % return on shares, or % of premium captured for options */
  pnlPercent: number | null;
  /**
   * Profit still to be earned if the (short) option expires worthless — i.e. the
   * net premium kept. Positive for short legs/credit spreads, negative for debit
   * spreads. null for shares (they don't expire).
   */
  projectedProfit: number | null;
  /** Daily theta decay in $ (positive = earning from decay) */
  theta?: number;
  /** Short strike of a spread (the sold leg) */
  shortStrike?: number;
  /** Long strike of a spread (the bought leg) */
  longStrike?: number;
}

// Summary view of a ticker in the wheel tracker list
export interface WheelTickerSummary {
  symbol: string;
  currentPhase: "csp_open" | "holding_shares" | "cc_open" | "idle";
  /** All active phases when multiple positions exist (e.g. CSP + CC + shares) */
  activePhases: ("csp_open" | "holding_shares" | "cc_open")[];
  /** True when holding shares but no covered call is open */
  hasUncoveredShares: boolean;
  /** Number of shares held (0 if none) */
  shareQuantity: number;
  /** IBKR average cost per share (actual purchase price, not premium-adjusted) */
  positionAvgCost: number | null;
  adjustedCostBasis: number; // per share
  totalPremiums: number;
  /** Net dividends across all cycles for this ticker */
  totalDividends: number;
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
  /** Unrealized P&L for the stock position only */
  sharePnL: number | null;
  /** Percent return on the stock position (vs avg cost) */
  sharePnLPercent: number | null;
  /** Summary of active short option positions */
  activeOptions: {
    nearestPut: { strike: number; expiry: string; dte: number } | null;
    nearestCall: { strike: number; expiry: string; dte: number } | null;
    totalPutContracts: number;
    totalCallContracts: number;
    /** Total unrealized P&L across all short puts */
    putsPnL: number | null;
    /** Percent of projected profit captured across all short puts */
    putsPnLPercent: number | null;
    /** Total unrealized P&L across all short calls */
    callsPnL: number | null;
    /** Percent of projected profit captured across all short calls */
    callsPnLPercent: number | null;
  };
  /** Individual live IBKR positions (shares + each option contract) */
  livePositions: WheelLivePosition[];
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
  suggestions: WheelSuggestion[];
}

// Response for wheel suggestions endpoint
export interface WheelSuggestionsResponse {
  suggestions: WheelSuggestion[];
}

// Payload broadcast over SSE ("wheel_strategy" event) when the background
// live-data refresh completes. Carries the freshly computed tickers + metrics
// so the client can replace the instant cached response it rendered first.
export interface WheelLiveUpdate {
  tickers: WheelTickerSummary[];
  metrics: WheelAggregateMetrics;
}
