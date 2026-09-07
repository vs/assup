/**
 * Yahoo Finance helpers for index-level data the IBKR feed doesn't expose
 * (e.g. VIX3M without a CBOE Indexes subscription).
 *
 * Uses the public v8 chart endpoint — no auth, no cookies, just a User-Agent.
 */

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_USER_AGENT = "Mozilla/5.0 (assup market-data fetcher)";
const FETCH_TIMEOUT_MS = 5000;

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
      };
    }>;
  };
}

/**
 * Fetch the latest 3-month CBOE Volatility Index (`^VIX3M`) close.
 * Returns null on any failure: HTTP error, timeout, missing field, non-positive value.
 * Never throws — callers handle the null fallback.
 */
export async function fetchVix3m(): Promise<number | null> {
  try {
    const url = `${YAHOO_CHART_URL}/%5EVIX3M?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as YahooChartResponse;
    const meta = json.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.chartPreviousClose;

    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return null;
    }
    return price;
  } catch {
    return null;
  }
}
