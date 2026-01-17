/**
 * Profit tracking types for options trading, dividends, and interest
 */

// Import batch tracking
export interface ImportBatch {
  id: string;
  filename: string;
  importedAt: string;
  periodStart: string;
  periodEnd: string;
  recordCount: number;
}

export interface ImportResult {
  batchId: string;
  filename: string;
  periodStart: string;
  periodEnd: string;
  stats: {
    tradesImported: number;
    tradesSkipped: number;
    dividendsImported: number;
    interestImported: number;
    otherCashImported: number;
    assignmentsDetected: number;
  };
}

// Imported trade record
export interface ImportedTrade {
  id: string;
  tradeId: string;
  symbol: string;
  description?: string;
  conId?: number;
  secType: string;
  strike?: number;
  expiry?: string;
  right?: "C" | "P";
  underlying?: string;
  multiplier: number;
  tradeDate: string;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  openClose?: string;
  wasAssigned: boolean;
  assignmentDate?: string;
}

// Cash transaction (dividend, interest, etc.)
export interface CashTransaction {
  id: string;
  transactionId: string;
  symbol?: string;
  description: string;
  transactionDate: string;
  amount: number;
  currency: string;
  type: CashTransactionType;
}

export type CashTransactionType =
  | "DIVIDEND"
  | "INTEREST"
  | "WITHHOLDING_TAX"
  | "FEE"
  | "OTHER";

// Option trade detail with profit calculation
export interface OptionTradeDetail {
  id: string;
  symbol: string;
  underlying: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  tradeDate: string;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  wasAssigned: boolean;
}

// Grouped option trade (open + close)
export interface OptionTradeGroup {
  underlying: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  openTrade?: OptionTradeDetail;
  closeTrade?: OptionTradeDetail;
  profit: number;
  wasAssigned: boolean;
}

// Monthly summary
export interface MonthSummary {
  year: number;
  month: number;
  optionsProfit: number;
  dividends: number;
  interest: number;
  withholdingTax: number;
  fees: number;
  total: number;
  tradeCount: number;
  assignedCount: number;
}

// Monthly detail response
export interface MonthDetail {
  year: number;
  month: number;
  realized: {
    optionTrades: OptionTradeGroup[];
    dividends: CashTransaction[];
    interest: CashTransaction[];
    withholdingTax: CashTransaction[];
    fees: CashTransaction[];
  };
  summary: MonthSummary;
}

// Current option position (from IBKR)
export interface CurrentOptionPosition {
  symbol: string;
  displayName: string;
  underlying: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  quantity: number;
  avgCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  projectedProfit: number;
  assetClassId?: string;
  assetClassName?: string;
  assetClassColor?: string;
}

// Current/next month profit view
export interface MonthProfitView {
  year: number;
  month: number;
  realized: {
    optionsProfit: number;
    dividends: number;
    interest: number;
    total: number;
    closedTrades: OptionTradeGroup[];
    cashTransactions: CashTransaction[];
  };
  unrealized: {
    value: number;
    positions: CurrentOptionPosition[];
  };
  projected: {
    value: number;
    positions: CurrentOptionPosition[];
  };
}

// Monthly profit list response
export interface MonthlyProfitResponse {
  months: MonthSummary[];
  totals: {
    optionsProfit: number;
    dividends: number;
    interest: number;
    withholdingTax: number;
    fees: number;
    total: number;
  };
}

// Import list response
export interface ImportListResponse {
  imports: ImportBatch[];
}
