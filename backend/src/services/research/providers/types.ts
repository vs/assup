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
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
}

export interface QuoteData {
  symbol: string;
  last: number | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
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

  // Screener
  searchTickers(criteria: {
    market?: string;
    type?: string;
    search?: string;
    active?: boolean;
    limit?: number;
  }): Promise<TickerSearchResult[]>;
}
