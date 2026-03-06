export interface OHLCV {
  date: string;       // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionsChainEntry {
  symbol: string;
  expiration: string;
  strike: number;
  right: "C" | "P";
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
}

export interface QuoteData {
  symbol: string;
  last: number;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export interface EarningsEvent {
  symbol: string;
  date: string;
  estimateEps: number | null;
  actualEps: number | null;
  quarter: string;
}

export interface DividendEvent {
  symbol: string;
  exDate: string;
  payDate: string | null;
  amount: number;
  frequency: string | null;
}

export interface AnalystRating {
  firm: string;
  rating: string;
  priceTarget: number | null;
  date: string;
  action: string;  // upgrade, downgrade, initiate, reiterate
}

export interface TickerSearchResult {
  symbol: string;
  name: string;
  market: string;       // "stocks", "otc"
  type: string;         // "CS" (common stock), "ETF", etc.
  active: boolean;
  marketCap: number | null;
  lastPrice: number | null;
}

export interface MarketDataProvider {
  name: string;

  // Price data
  getQuote(symbol: string): Promise<QuoteData>;
  getHistoricalOHLCV(
    symbol: string,
    from: string,
    to: string,
    timespan?: "day" | "week" | "month"
  ): Promise<OHLCV[]>;

  // Options
  getOptionsChain(
    symbol: string,
    expirations?: number
  ): Promise<OptionsChainEntry[]>;

  // Events
  getEarningsCalendar(symbol: string): Promise<EarningsEvent[]>;
  getDividendCalendar(symbol: string): Promise<DividendEvent[]>;

  // Analyst
  getAnalystRatings(symbol: string): Promise<AnalystRating[]>;

  // Screener
  searchTickers(criteria: {
    market?: string;
    type?: string;
    search?: string;
    active?: boolean;
    limit?: number;
  }): Promise<TickerSearchResult[]>;
}
