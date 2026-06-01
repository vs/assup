/**
 * TradingView scanner utility for fetching index quotes (SPX, VIX).
 * Uses the public scanner API — no authentication required.
 */

interface TvScanResponse {
  data: Array<{
    s: string; // symbol
    d: (number | null)[]; // column values
  }>;
}

const SCANNER_URL = "https://scanner.tradingview.com/america/scan";

// --- Macro-specific enriched fetch ---

export interface MacroQuote {
  close: number | null;
  change: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  recommendAll: number | null;
  volatility: number | null;
  high: number | null;
  low: number | null;
}

export type MacroQuotes = Record<string, MacroQuote>;

const MACRO_SYMBOLS = ["SP:SPX", "CBOE:VIX", "AMEX:HYG", "NASDAQ:TLT"];

const MACRO_COLUMNS = [
  "close",
  "change",
  "RSI",
  "SMA20",
  "SMA50",
  "SMA200",
  "Recommend.All",
  "Volatility.D",
  "high",
  "low",
] as const;

/**
 * Fetch enriched macro data for SPX, VIX, HYG, TLT in a single call.
 * Returns per-symbol structured data with indicators.
 */
export async function fetchMacroQuotes(): Promise<MacroQuotes> {
  const body = {
    symbols: { tickers: MACRO_SYMBOLS },
    columns: [...MACRO_COLUMNS],
  };

  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `TradingView macro request failed: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as TvScanResponse;

  const result: MacroQuotes = {};
  for (const row of json.data) {
    const d = row.d;
    result[row.s] = {
      close: (d[0] as number) ?? null,
      change: (d[1] as number) ?? null,
      rsi: (d[2] as number) ?? null,
      sma20: (d[3] as number) ?? null,
      sma50: (d[4] as number) ?? null,
      sma200: (d[5] as number) ?? null,
      recommendAll: (d[6] as number) ?? null,
      volatility: (d[7] as number) ?? null,
      high: (d[8] as number) ?? null,
      low: (d[9] as number) ?? null,
    };
  }

  return result;
}
