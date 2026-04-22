import type {
  MarketDataProvider,
  OHLCV,
  QuoteData,
  OptionsChainEntry,
  EarningsEvent,
  DividendEvent,
  TickerSearchResult,
} from "./types.js";

const BASE_URL = "https://api.polygon.io";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 15_000; // 15s base delay on 429

function getMinRequestInterval(): number {
  const rpm = parseInt(process.env.POLYGON_RATE_LIMIT_RPM || "5", 10);
  return Math.ceil(60_000 / rpm);
}

export interface TickerDetails {
  name: string;
  description: string;
  sector: string | null;
  industry: string | null;
  type: string | null;
  marketCap: number | null;
}

// Shared rate limiter across all PolygonProvider instances
let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();

/** Reset rate limiter state — for tests only */
export function _resetRateLimiter(): void {
  lastRequestTime = 0;
  requestQueue = Promise.resolve();
}

export class PolygonProvider implements MarketDataProvider {
  name = "polygon";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.MARKET_DATA_API_KEY || "";
    if (!this.apiKey) {
      console.warn("MARKET_DATA_API_KEY not set — Polygon provider will fail");
    }
  }

  private async rateLimitedFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    // Chain onto the queue so requests are serialized
    return new Promise<T>((resolve, reject) => {
      requestQueue = requestQueue.then(async () => {
        try {
          const result = await this.fetchWithRetry<T>(path, params);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private async fetchWithRetry<T>(path: string, params: Record<string, string>, attempt = 0): Promise<T> {
    // Enforce minimum interval between requests
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < getMinRequestInterval()) {
      await new Promise((r) => setTimeout(r, getMinRequestInterval() - elapsed));
    }
    lastRequestTime = Date.now();

    const url = new URL(path, BASE_URL);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await globalThis.fetch(url.toString());

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Polygon 429 rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, delay));
      lastRequestTime = Date.now();
      return this.fetchWithRetry<T>(path, params, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Polygon API error ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    return this.rateLimitedFetch<T>(path, params);
  }

  async getQuote(symbol: string): Promise<QuoteData> {
    const data = await this.fetch<{
      ticker?: {
        lastTrade?: { p: number };
        prevDay?: { c: number; o: number; h: number; l: number; v: number };
        day?: { o: number; h: number; l: number; v: number };
      } | null;
    }>(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);

    if (!data.ticker) {
      throw new Error(`Polygon snapshot returned no ticker data for ${symbol}`);
    }

    const t = data.ticker;
    const prev = t.prevDay;
    const day = t.day;
    return {
      symbol,
      last: t.lastTrade?.p ?? prev?.c ?? null,
      close: prev?.c ?? null,
      open: day?.o ?? prev?.o ?? null,
      high: day?.h ?? prev?.h ?? null,
      low: day?.l ?? prev?.l ?? null,
      volume: day?.v ?? prev?.v ?? null,
    };
  }

  async getHistoricalOHLCV(
    symbol: string,
    from: string,
    to: string,
    timespan: "day" | "week" | "month" = "day"
  ): Promise<OHLCV[]> {
    const data = await this.fetch<{
      results: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
    }>(`/v2/aggs/ticker/${symbol}/range/1/${timespan}/${from}/${to}`, {
      adjusted: "true",
      sort: "asc",
      limit: "5000",
    });

    return (data.results || []).map((r) => ({
      date: new Date(r.t).toISOString().split("T")[0],
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));
  }

  async getOptionsChain(
    _symbol: string,
    _expirations = 4
  ): Promise<OptionsChainEntry[]> {
    throw new Error("Options chain not supported via Polygon — use IBKR");
  }

  async getEarningsCalendar(symbol: string): Promise<EarningsEvent[]> {
    const data = await this.fetch<{
      results: Array<{
        ticker: string;
        date: string;
        eps: { estimate: number | null; actual: number | null };
        quarter: number;
        year: number;
      }>;
    }>(`/vX/reference/financials`, {
      ticker: symbol,
      limit: "8",
      sort: "period_of_report_date",
      order: "desc",
    });

    return (data.results || []).map((r) => ({
      symbol: r.ticker,
      date: r.date,
      estimateEps: r.eps?.estimate ?? null,
      actualEps: r.eps?.actual ?? null,
      quarter: `Q${r.quarter} ${r.year}`,
    }));
  }

  async getDividendCalendar(symbol: string): Promise<DividendEvent[]> {
    const data = await this.fetch<{
      results: Array<{
        ticker: string;
        ex_dividend_date: string;
        pay_date: string | null;
        cash_amount: number;
        frequency: number;
      }>;
    }>(`/v3/reference/dividends`, {
      ticker: symbol,
      limit: "12",
      order: "desc",
      sort: "ex_dividend_date",
    });

    const freqMap: Record<number, string> = {
      1: "annual",
      2: "semi-annual",
      4: "quarterly",
      12: "monthly",
    };

    return (data.results || []).map((r) => ({
      symbol: r.ticker,
      exDate: r.ex_dividend_date,
      payDate: r.pay_date,
      amount: r.cash_amount,
      frequency: freqMap[r.frequency] || null,
    }));
  }

  async searchTickers(criteria: {
    market?: string;
    type?: string;
    search?: string;
    active?: boolean;
    limit?: number;
  }): Promise<TickerSearchResult[]> {
    const params: Record<string, string> = {
      market: criteria.market || "stocks",
      active: String(criteria.active ?? true),
      limit: String(criteria.limit || 100),
      sort: "ticker",
      order: "asc",
    };
    if (criteria.type) params.type = criteria.type;
    if (criteria.search) params.search = criteria.search;

    const data = await this.fetch<{
      results: Array<{
        ticker: string;
        name: string;
        market: string;
        type: string;
        active: boolean;
      }>;
    }>("/v3/reference/tickers", params);

    const tickers = data.results || [];
    if (tickers.length === 0) return [];

    // Build base results
    const results: TickerSearchResult[] = tickers.map((t) => ({
      symbol: t.ticker,
      name: t.name,
      market: t.market,
      type: t.type,
      active: t.active,
      marketCap: null,
      lastPrice: null,
    }));

    // Try to enrich with snapshot data for market cap and last price
    try {
      const tickerList = tickers.map((t) => t.ticker).join(",");
      const snapshots = await this.fetch<{
        tickers: Array<{
          ticker: string;
          todaysChange: number;
          lastTrade: { p: number };
          prevDay: { c: number };
          day: { v: number };
        }>;
      }>("/v2/snapshot/locale/us/markets/stocks/tickers", {
        tickers: tickerList,
      });

      const snapshotMap = new Map(
        (snapshots.tickers || []).map((s) => [s.ticker, s])
      );

      for (const result of results) {
        const snap = snapshotMap.get(result.symbol);
        if (snap) {
          result.lastPrice = snap.lastTrade?.p ?? snap.prevDay?.c ?? null;
        }
      }
    } catch {
      // Snapshot enrichment is best-effort; leave marketCap and lastPrice as null
    }

    return results;
  }

  async getTickerDetails(symbol: string): Promise<TickerDetails> {
    const data = await this.fetch<{
      results: {
        ticker: string;
        name: string;
        description?: string;
        sic_description?: string;
        type?: string;
        market_cap?: number;
      } | null;
    }>(`/v3/reference/tickers/${symbol}`);

    if (!data.results) {
      throw new Error(`Polygon ticker details returned no data for ${symbol}`);
    }

    const r = data.results;
    return {
      name: r.name,
      description: r.description || "",
      sector: null,
      industry: r.sic_description || null,
      type: r.type || null,
      marketCap: r.market_cap ?? null,
    };
  }
}

export function createPolygonProvider(): MarketDataProvider {
  return new PolygonProvider();
}
