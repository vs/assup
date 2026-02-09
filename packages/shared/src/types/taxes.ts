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
