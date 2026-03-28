/**
 * TradingView scanner utility for fetching index quotes (SPX, VIX).
 * Uses the public scanner API — no authentication required.
 */

interface TvQuote {
  close: number | null;
  change: number | null;
  high: number | null;
  low: number | null;
}

export interface TvIndicators {
  recommendAll: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  sma50: number | null;
  sma200: number | null;
  atr: number | null;
  volatility: number | null;
  close: number | null;
  change: number | null;
  volume: number | null;
  marketCap: number | null;
}

interface TvScanResponse {
  data: Array<{
    s: string; // symbol
    d: (number | null)[]; // column values
  }>;
}

const SCANNER_URL = "https://scanner.tradingview.com/america/scan";

/**
 * Fetch real-time quotes for the given TradingView symbols.
 * Example symbols: "SP:SPX", "CBOE:VIX"
 */
export async function fetchTvQuotes(
  symbols: string[]
): Promise<Record<string, TvQuote>> {
  const body = {
    symbols: { tickers: symbols },
    columns: ["close", "change", "high", "low"],
  };

  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `TradingView scanner request failed: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as TvScanResponse;

  const result: Record<string, TvQuote> = {};
  for (const row of json.data) {
    result[row.s] = {
      close: row.d[0] ?? null,
      change: row.d[1] ?? null,
      high: row.d[2] ?? null,
      low: row.d[3] ?? null,
    };
  }

  return result;
}

const INDICATOR_COLUMNS = [
  "Recommend.All",
  "RSI",
  "MACD.macd",
  "MACD.signal",
  "SMA50",
  "SMA200",
  "ATR",
  "Volatility.D",
  "close",
  "change",
  "volume",
  "market_cap_basic",
] as const;

/**
 * Fetch pre-computed technical indicators for an array of symbols.
 * Symbols should be in TradingView format, e.g. "NASDAQ:AAPL".
 * Plain tickers like "AAPL" are auto-prefixed with "NASDAQ:".
 */
export async function fetchTvIndicators(
  symbols: string[]
): Promise<Record<string, TvIndicators>> {
  const tickers = symbols.map((s) =>
    s.includes(":") ? s : `NASDAQ:${s}`
  );

  const body = {
    symbols: { tickers },
    columns: [...INDICATOR_COLUMNS],
  };

  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `TradingView indicator request failed: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as TvScanResponse;

  const result: Record<string, TvIndicators> = {};
  for (const row of json.data) {
    const d = row.d;
    result[row.s] = {
      recommendAll: (d[0] as number) ?? null,
      rsi: (d[1] as number) ?? null,
      macd: (d[2] as number) ?? null,
      macdSignal: (d[3] as number) ?? null,
      sma50: (d[4] as number) ?? null,
      sma200: (d[5] as number) ?? null,
      atr: (d[6] as number) ?? null,
      volatility: (d[7] as number) ?? null,
      close: (d[8] as number) ?? null,
      change: (d[9] as number) ?? null,
      volume: (d[10] as number) ?? null,
      marketCap: (d[11] as number) ?? null,
    };
  }

  return result;
}
