// Exchange Rate Types
export interface ExchangeRate {
  id: number;
  date: string; // ISO date string
  currency: string;
  rate: number;
  source: string;
}

export interface ExchangeRateStatus {
  year: number;
  totalTradingDays: number;
  loadedDays: number;
  missingDates: string[];
  currencies: string[];
}

// Tax Summary Types
export interface TaxSummary {
  year: number;
  securities: {
    income: number;
    expenses: number;
    profit: number;
    tradeCount: number;
    exemptCount: number; // 3yr+ holding
  };
  derivatives: {
    income: number;
    expenses: number;
    profit: number;
    tradeCount: number;
  };
  dividends: {
    gross: number;
    withholdingTax: number;
    net: number;
    byCountry: DividendsByCountry[];
  };
  interest: {
    total: number;
    count: number;
  };
  missingRecords: MissingTradeRecord[];
  canExport: boolean;
}

export interface DividendsByCountry {
  country: string;
  gross: number;
  withholdingTax: number;
  net: number;
  count: number;
}

export interface MissingTradeRecord {
  symbol: string;
  tradeDate: string;
  quantity: number;
  proceeds: number;
  type: "stock" | "option";
  description: string;
}

// Stock Trade for Tax Reporting
export interface TaxStockTrade {
  id: string;
  symbol: string;
  quantity: number;
  dateOpened: string | null;
  dateClosed: string;
  holdingDays: number | null;
  isExempt: boolean; // 3yr+ holding
  proceedsUsd: number;
  costBasisUsd: number;
  pnlUsd: number;
  rateOpen: number | null;
  rateClosed: number;
  proceedsCzk: number;
  costBasisCzk: number | null;
  pnlCzk: number | null;
  status: "complete" | "missing_buy";
  currency: string;
}

// Option Trade for Tax Reporting
export interface TaxOptionTrade {
  id: string;
  symbol: string;
  description: string; // e.g., "AAPL 150 PUT 2025-03"
  quantity: number;
  closeType: "closed" | "expired" | "assigned";
  dateClosed: string;
  proceedsUsd: number;
  costBasisUsd: number;
  pnlUsd: number;
  rate: number;
  proceedsCzk: number;
  costBasisCzk: number;
  pnlCzk: number;
  status: "complete" | "missing_open";
  currency: string;
}

// Dividend for Tax Reporting
export interface TaxDividend {
  id: string;
  date: string;
  symbol: string;
  country: string;
  grossUsd: number;
  withholdingTaxUsd: number;
  netUsd: number;
  rate: number;
  grossCzk: number;
  withholdingTaxCzk: number;
  netCzk: number;
  currency: string;
}

// Interest for Tax Reporting
export interface TaxInterest {
  id: string;
  date: string;
  description: string;
  amountUsd: number;
  rate: number;
  amountCzk: number;
  currency: string;
}

// API Response Types
export interface TaxStockTradesResponse {
  trades: TaxStockTrade[];
  totals: {
    income: number;
    expenses: number;
    profit: number;
  };
}

export interface TaxOptionTradesResponse {
  trades: TaxOptionTrade[];
  totals: {
    income: number;
    expenses: number;
    profit: number;
  };
}

export interface TaxDividendsResponse {
  dividends: TaxDividend[];
  byCountry: DividendsByCountry[];
  totals: {
    gross: number;
    withholdingTax: number;
    net: number;
  };
}

export interface TaxInterestResponse {
  interest: TaxInterest[];
  total: number;
}

// Lot Trace Types (FIFO visualization)
export interface LotTraceResponse {
  symbol: string;
  entries: LotTraceEntry[];
  currentPosition: number;
}

export interface LotTraceEntry {
  type: "buy" | "sell" | "corporate_action";
  id: string;
  lotRef: string;
  tradeDate: string;
  quantity: number;
  pricePerShare: number;
  exchangeRate: number;
  currency: string;
  // BUY fields
  costBasisUsd?: number;
  costBasisCzk?: number;
  remainingQty?: number;
  // SELL fields
  proceedsUsd?: number;
  proceedsCzk?: number;
  consumedLots?: ConsumedLot[];
  // CORPORATE_ACTION fields
  actionType?: string; // FS, RS, SD, TC, SO
  actionDescription?: string; // e.g., "SPLIT 10 FOR 1"
  splitRatio?: number; // e.g., 10 for 10:1 split
  affectedLots?: AffectedLot[]; // which lots were adjusted
}

export interface AffectedLot {
  lotRef: string;
  quantityBefore: number;
  quantityAfter: number;
}

export interface ConsumedLot {
  lotRef: string;
  quantity: number;
  costBasisUsd: number;
  costBasisCzk: number;
  pnlUsd: number;
  pnlCzk: number;
  holdingDays: number;
  isExempt: boolean;
}

// Option Lot Trace Types (FIFO visualization for options)
export interface OptionLotTraceResponse {
  symbol: string;
  description: string;
  entries: OptionLotTraceEntry[];
  currentPosition: number;
}

export interface OptionLotTraceEntry {
  type: "open" | "close";
  id: string;
  lotRef: string;
  tradeDate: string;
  quantity: number;
  action: string; // "SELL to open", "BUY to close", etc.
  premiumPerContract: number;
  totalPremium: number;
  exchangeRate: number;
  totalPremiumCzk: number;
  currency: string;
  // OPEN fields
  remainingQty?: number;
  // CLOSE fields
  closeType?: "closed" | "expired" | "assigned";
  consumedLots?: OptionConsumedLot[];
}

export interface OptionConsumedLot {
  lotRef: string;
  quantity: number;
  openPremiumUsd: number;
  openPremiumCzk: number;
  closePremiumUsd: number;
  closePremiumCzk: number;
  pnlUsd: number;
  pnlCzk: number;
  holdingDays: number;
}
