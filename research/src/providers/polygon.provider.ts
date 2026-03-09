import type {
  MarketDataProvider,
  OHLCV,
  QuoteData,
  OptionsChainEntry,
  EarningsEvent,
  DividendEvent,
  AnalystRating,
  TickerSearchResult,
} from "./types.js";

const BASE_URL = "https://api.polygon.io";

class PolygonProvider implements MarketDataProvider {
  name = "polygon";
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.MARKET_DATA_API_KEY || "";
    if (!this.apiKey) {
      console.warn("MARKET_DATA_API_KEY not set — Polygon provider will fail");
    }
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, BASE_URL);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await globalThis.fetch(url.toString());
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Polygon API error ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
  }

  async getQuote(symbol: string): Promise<QuoteData> {
    const data = await this.fetch<{
      ticker: {
        lastTrade?: { p: number };
        prevDay?: { c: number; o: number; h: number; l: number; v: number };
        day?: { o: number; h: number; l: number; v: number };
      };
    }>(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);

    const t = data.ticker;
    const prev = t.prevDay;
    const day = t.day;
    return {
      symbol,
      last: t.lastTrade?.p ?? prev?.c ?? 0,
      close: prev?.c ?? 0,
      open: day?.o ?? prev?.o ?? 0,
      high: day?.h ?? prev?.h ?? 0,
      low: day?.l ?? prev?.l ?? 0,
      volume: day?.v ?? prev?.v ?? 0,
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
    symbol: string,
    expirations = 4
  ): Promise<OptionsChainEntry[]> {
    const data = await this.fetch<{
      results: Array<{
        details: {
          contract_type: string;
          expiration_date: string;
          strike_price: number;
        };
        day: { volume: number };
        open_interest: number;
        implied_volatility: number;
        greeks: { delta: number; gamma: number; theta: number } | null;
        last_quote: { bid: number; ask: number };
        last_trade: { price: number };
        underlying_asset: { ticker: string };
      }>;
    }>(`/v3/snapshot/options/${symbol}`, {
      limit: "250",
      order: "asc",
      sort: "expiration_date",
    });

    const entries: OptionsChainEntry[] = (data.results || []).map((r) => ({
      symbol: r.underlying_asset.ticker,
      expiration: r.details.expiration_date,
      strike: r.details.strike_price,
      right: r.details.contract_type === "call" ? "C" as const : "P" as const,
      bid: r.last_quote?.bid || 0,
      ask: r.last_quote?.ask || 0,
      last: r.last_trade?.price || 0,
      volume: r.day?.volume || 0,
      openInterest: r.open_interest || 0,
      impliedVolatility: r.implied_volatility || 0,
      delta: r.greeks?.delta ?? null,
      gamma: r.greeks?.gamma ?? null,
      theta: r.greeks?.theta ?? null,
    }));

    // Filter to nearest N expirations
    const uniqueExpiries = [...new Set(entries.map((e) => e.expiration))].sort();
    const targetExpiries = new Set(uniqueExpiries.slice(0, expirations));
    return entries.filter((e) => targetExpiries.has(e.expiration));
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

  async getAnalystRatings(_symbol: string): Promise<AnalystRating[]> {
    // Polygon doesn't have analyst ratings — return empty
    // This will be filled by the analyst_consensus collector from another source
    return [];
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
}

export function createPolygonProvider(): MarketDataProvider {
  return new PolygonProvider();
}
