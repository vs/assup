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
  valueTest: {
    grossProceedsCzk: number; // Total gross proceeds from all security sales
    thresholdCzk: number; // 100,000 (constant)
    isExempt: boolean; // grossProceedsCzk < thresholdCzk
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
  wasFromAssignment?: boolean; // True if cost basis uses strike price from PUT assignment
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
  dividends: TaxDividendWithSource[];
  byCountry: DividendsByCountry[];
  totals: {
    gross: number;
    withholdingTax: number;
    net: number;
  };
  // New: rows in the Dividend Report we couldn't match to a FLEX dividend.
  unmatchedDividendReport: Array<{ symbol: string; payDate: string }>;
  // New: informational buckets for non-dividend/non-interest components.
  capitalGains: TaxDividendWithSource[];
  returnOfCapital: TaxDividendWithSource[];
  paymentInLieu: TaxDividendWithSource[];
}

export interface TaxInterestResponse {
  interest: TaxInterestWithSource[];
  total: number;
  // New: positive WHT entries that couldn't be paired to an original.
  unpairedReversals: Array<{
    transactionId: string;
    symbol: string | null;
    description: string;
    amountUsd: number;
    date: string;
  }>;
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

// Provenance tag for a tax-report row.
export type TaxSource = "dividend-report" | "flex" | "flex+reversal";

// Mapped category from RevenueComponent.
export type TaxCategory =
  | "DIVIDEND"
  | "INTEREST"
  | "CAPITAL_GAIN"
  | "ROC"
  | "PIL";

// One Dividend Report record (one RevenueComponent row from IBKR CSV).
export interface DividendReportRecordView {
  id: string;
  symbol: string;
  payDate: string; // ISO date
  exDate: string | null;
  shares: number | null;
  country: string | null;
  revenueComponent: string;
  qualifiedIndicator: string | null;
  taxCategory: TaxCategory;
  currency: string;
  grossUsd: number;
  withholdUsd: number;
}

// Dividend Report upload summary.
export interface DividendReportUploadView {
  id: string;
  filename: string;
  uploadedAt: string; // ISO timestamp
  accountNumber: string | null;
  taxYear: number;
  recordCount: number;
}

// Detail response: upload + records + match diagnostics against FLEX.
export interface DividendReportUploadDetail {
  upload: DividendReportUploadView;
  records: DividendReportRecordView[];
  matchSummary: {
    matchedFlexCount: number;
    recordsWithoutFlex: Array<{ symbol: string; payDate: string }>;
  };
}

// Upload result returned by POST /api/taxes/dividend-report.
export interface DividendReportUploadResult {
  status: "created" | "replaced" | "duplicate";
  upload: DividendReportUploadView;
  replacedUploadId?: string; // present when status === "replaced"
  matchSummary: {
    matchedFlexCount: number;
    recordsWithoutFlex: Array<{ symbol: string; payDate: string }>;
  };
}

// Provenance-tagged dividend row for tax UI.
export interface TaxDividendWithSource extends TaxDividend {
  source: TaxSource;
}

// Provenance-tagged interest row for tax UI.
export interface TaxInterestWithSource extends TaxInterest {
  source: TaxSource;
  // True when this interest row came from a DividendReportRecord (i.e., from
  // a security like TLT) rather than broker credit interest.
  fromSecurity: boolean;
  symbol?: string; // present when fromSecurity is true
}
