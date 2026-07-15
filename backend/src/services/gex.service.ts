/**
 * GEX (Gamma Exposure) calculation service.
 *
 * Fetches options chain data from Yahoo Finance, calculates Black-Scholes
 * gamma per contract, computes GEX per strike, and identifies key dealer
 * positioning levels (put wall, call wall, GEX flip).
 */

import type {
  GexAnalysisResponse,
  GexStrikeData,
  GexKeyLevels,
  GexSummary,
} from "@assup/shared";

// --- Yahoo Finance symbol mapping ---

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  SPX: "^SPX",
  XSP: "^XSP",
  RUT: "^RUT",
  SPY: "SPY",
  QQQ: "QQQ",
  IWM: "IWM",
};

/** Map a spread builder symbol to its Yahoo Finance equivalent. */
export function toYahooSymbol(symbol: string): string {
  return YAHOO_SYMBOL_MAP[symbol.toUpperCase()] ?? symbol;
}

// --- Black-Scholes Gamma ---

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Standard normal probability density function N'(x).
 */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Black-Scholes gamma for a European option.
 *
 * gamma = N'(d1) / (S * sigma * sqrt(T))
 *
 * @param spot    - Current underlying price
 * @param strike  - Option strike price
 * @param sigma   - Implied volatility (as decimal, e.g. 0.20 for 20%)
 * @param T       - Time to expiry in years (e.g. 7/365)
 * @param r       - Risk-free rate (default 0.05)
 */
export function bsGamma(
  spot: number,
  strike: number,
  sigma: number,
  T: number,
  r = 0.05,
): number {
  if (spot <= 0 || strike <= 0 || sigma <= 0 || T <= 0) return 0;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);

  return normPdf(d1) / (spot * sigma * sqrtT);
}

// --- Per-Strike GEX ---

export interface CalcStrikeGEXInput {
  spot: number;
  strike: number;
  callOI: number;
  putOI: number;
  callIV: number;   // decimal (e.g. 0.20)
  putIV: number;    // decimal (e.g. 0.22)
  callVolume: number;
  putVolume: number;
  T: number;        // years
  riskFreeRate?: number;
}

/**
 * Calculate GEX for a single strike.
 *
 * GEX = OI * Gamma * contractMultiplier * spot^2 * 0.01
 * Calls: positive (dealers long gamma). Puts: negative (dealers short gamma).
 */
export function calcStrikeGEX(input: CalcStrikeGEXInput): GexStrikeData {
  const { spot, strike, callOI, putOI, callIV, putIV, callVolume, putVolume, T, riskFreeRate = 0.05 } = input;

  const contractMultiplier = 100;
  const scaleFactor = contractMultiplier * spot * spot * 0.01;

  const callGamma = bsGamma(spot, strike, callIV, T, riskFreeRate);
  const putGamma = bsGamma(spot, strike, putIV, T, riskFreeRate);

  const callGEX = callOI * callGamma * scaleFactor;
  const putGEX = putOI === 0 ? 0 : -(putOI * putGamma * scaleFactor);
  const netGEX = callGEX + putGEX;

  return {
    strike,
    callOI,
    putOI,
    callVolume,
    putVolume,
    callGEX,
    putGEX,
    netGEX,
  };
}

// --- Key Levels ---

/**
 * Identify key GEX levels from per-strike data.
 */
export function findKeyLevels(strikes: GexStrikeData[]): GexKeyLevels {
  if (strikes.length === 0) {
    return {
      putWall: { strike: 0, oi: 0 },
      callWall: { strike: 0, oi: 0 },
      gexFlip: null,
      maxPositiveGEX: { strike: 0, gex: 0 },
      maxNegativeGEX: { strike: 0, gex: 0 },
    };
  }

  // Put wall: strike with highest put OI
  let putWall = strikes[0];
  for (const s of strikes) {
    if (s.putOI > putWall.putOI) putWall = s;
  }

  // Call wall: strike with highest call OI
  let callWall = strikes[0];
  for (const s of strikes) {
    if (s.callOI > callWall.callOI) callWall = s;
  }

  // Max positive and negative GEX
  let maxPos = strikes[0];
  let maxNeg = strikes[0];
  for (const s of strikes) {
    if (s.netGEX > maxPos.netGEX) maxPos = s;
    if (s.netGEX < maxNeg.netGEX) maxNeg = s;
  }

  // GEX flip: where netGEX crosses zero (linear interpolation)
  let gexFlip: number | null = null;
  const sorted = [...strikes].sort((a, b) => a.strike - b.strike);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if ((a.netGEX <= 0 && b.netGEX > 0) || (a.netGEX >= 0 && b.netGEX < 0)) {
      const range = b.netGEX - a.netGEX;
      if (range !== 0) {
        const t = -a.netGEX / range;
        gexFlip = a.strike + t * (b.strike - a.strike);
        gexFlip = Math.round(gexFlip * 100) / 100;
      }
      break;
    }
  }

  return {
    putWall: { strike: putWall.strike, oi: putWall.putOI },
    callWall: { strike: callWall.strike, oi: callWall.callOI },
    gexFlip,
    maxPositiveGEX: { strike: maxPos.strike, gex: maxPos.netGEX },
    maxNegativeGEX: { strike: maxNeg.strike, gex: maxNeg.netGEX },
  };
}

// --- Summary ---

/**
 * Calculate GEX summary metrics.
 */
export function calcSummary(strikes: GexStrikeData[], spot: number): GexSummary {
  let totalPutOI = 0;
  let totalCallOI = 0;
  for (const s of strikes) {
    totalPutOI += s.putOI;
    totalCallOI += s.callOI;
  }

  const putCallRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  // Regime: based on netGEX at the strike closest to spot
  let nearest = strikes[0];
  let nearestDist = Infinity;
  for (const s of strikes) {
    const dist = Math.abs(s.strike - spot);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = s;
    }
  }
  const netGEXRegime = nearest && nearest.netGEX >= 0 ? "positive" : "negative";

  const levels = findKeyLevels(strikes);

  return {
    totalPutOI,
    totalCallOI,
    putCallRatio: Math.round(putCallRatio * 100) / 100,
    netGEXRegime,
    gexFlipLevel: levels.gexFlip,
  };
}

// --- Yahoo Finance Fetch ---

interface YahooOptionContract {
  strike: number;
  openInterest: number;
  volume: number;
  impliedVolatility: number;
  bid: number;
  ask: number;
}

interface YahooOptionsResponse {
  optionChain: {
    result: Array<{
      quote: {
        regularMarketPrice: number;
      };
      expirationDates: number[];
      options: Array<{
        expirationDate: number;
        calls: YahooOptionContract[];
        puts: YahooOptionContract[];
      }>;
    }>;
    error: null | { code: string; description: string };
  };
}

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch options chain for a single expiration from Yahoo Finance.
 * If no expirationUnix is provided, returns the default (nearest) expiration.
 */
async function fetchYahooOptionsChain(
  yahooSymbol: string,
  expirationUnix?: number,
): Promise<YahooOptionsResponse> {
  const url = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(yahooSymbol)}`);
  if (expirationUnix != null) {
    url.searchParams.set("date", String(expirationUnix));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await globalThis.fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Yahoo Finance returned ${response.status}: ${body.slice(0, 200)}`);
    }

    return response.json() as Promise<YahooOptionsResponse>;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- In-Memory Cache ---

interface CacheEntry {
  data: GexAnalysisResponse;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Cache TTL: until 4 PM ET or 4 hours, whichever is shorter.
 */
function isCacheValid(entry: CacheEntry): boolean {
  const now = Date.now();
  const age = now - entry.fetchedAt;
  const MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

  if (age >= MAX_AGE_MS) return false;

  // Check if market has closed since cache was set (4 PM ET)
  const etNow = new Date(now).toLocaleString("en-US", { timeZone: "America/New_York" });
  const etDate = new Date(etNow);
  const marketCloseHour = 16;
  const etHour = etDate.getHours();

  const etFetchedAt = new Date(entry.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York" });
  const fetchedDate = new Date(etFetchedAt);
  const fetchedHour = fetchedDate.getHours();

  if (fetchedDate.toDateString() !== etDate.toDateString()) return false;
  if (fetchedHour < marketCloseHour && etHour >= marketCloseHour) return false;

  return true;
}

function getCacheKey(symbol: string, expiration: string | null, aggregate: boolean): string {
  return `${symbol}:${aggregate ? "aggregate" : expiration ?? "default"}`;
}

// --- Public API ---

const AGGREGATE_MAX_DTE = 7;
const AGGREGATE_FETCH_DELAY_MS = 200;

/**
 * Get GEX analysis for a symbol. Returns cached data if fresh.
 */
export async function getGexAnalysis(
  symbol: string,
  expiration: string | null,
  aggregate: boolean,
  forceRefresh = false,
): Promise<GexAnalysisResponse> {
  const yahooSymbol = toYahooSymbol(symbol);
  const cacheKey = getCacheKey(symbol, expiration, aggregate);

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached && isCacheValid(cached)) {
      return cached.data;
    }
  }

  const initial = await fetchYahooOptionsChain(yahooSymbol);
  const result = initial.optionChain.result[0];
  if (!result) throw new Error(`No options data for ${symbol} (${yahooSymbol})`);

  const spot = result.quote.regularMarketPrice;
  const expirationDates = result.expirationDates;

  const expirationStrings = expirationDates.map((ts) => {
    const d = new Date(ts * 1000);
    return d.toISOString().split("T")[0];
  });

  let expirationsToFetch: number[] = [];
  let analyzedExpiration: string | null = null;
  let isAggregate = false;

  if (aggregate) {
    isAggregate = true;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const maxDate = new Date(now.getTime() + AGGREGATE_MAX_DTE * 24 * 60 * 60 * 1000);
    expirationsToFetch = expirationDates.filter((ts) => {
      const d = new Date(ts * 1000);
      return d >= now && d <= maxDate;
    });
  } else if (expiration) {
    const match = expirationDates.find((ts) => {
      const d = new Date(ts * 1000);
      return d.toISOString().split("T")[0] === expiration;
    });
    if (match) {
      expirationsToFetch = [match];
      analyzedExpiration = expiration;
    } else {
      throw new Error(`Expiration ${expiration} not available for ${symbol}. Available: ${expirationStrings.slice(0, 5).join(", ")}`);
    }
  } else {
    if (result.options.length > 0) {
      const firstOpts = result.options[0];
      expirationsToFetch = [firstOpts.expirationDate];
      const d = new Date(firstOpts.expirationDate * 1000);
      analyzedExpiration = d.toISOString().split("T")[0];
    }
  }

  const allOptions: Array<{ expirationDate: number; calls: YahooOptionContract[]; puts: YahooOptionContract[] }> = [];

  for (let i = 0; i < expirationsToFetch.length; i++) {
    const expUnix = expirationsToFetch[i];
    const existing = result.options.find((o) => o.expirationDate === expUnix);
    if (existing) {
      allOptions.push(existing);
    } else {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, AGGREGATE_FETCH_DELAY_MS));
      }
      const resp = await fetchYahooOptionsChain(yahooSymbol, expUnix);
      const opts = resp.optionChain.result[0]?.options[0];
      if (opts) allOptions.push(opts);
    }
  }

  const strikeMap = new Map<number, { callOI: number; putOI: number; callVol: number; putVol: number; callIV: number; putIV: number; callCount: number; putCount: number }>();

  for (const opts of allOptions) {
    for (const call of opts.calls) {
      const entry = strikeMap.get(call.strike) ?? { callOI: 0, putOI: 0, callVol: 0, putVol: 0, callIV: 0, putIV: 0, callCount: 0, putCount: 0 };
      entry.callOI += call.openInterest ?? 0;
      entry.callVol += call.volume ?? 0;
      entry.callIV += call.impliedVolatility ?? 0;
      entry.callCount += 1;
      strikeMap.set(call.strike, entry);
    }

    for (const put of opts.puts) {
      const entry = strikeMap.get(put.strike) ?? { callOI: 0, putOI: 0, callVol: 0, putVol: 0, callIV: 0, putIV: 0, callCount: 0, putCount: 0 };
      entry.putOI += put.openInterest ?? 0;
      entry.putVol += put.volume ?? 0;
      entry.putIV += put.impliedVolatility ?? 0;
      entry.putCount += 1;
      strikeMap.set(put.strike, entry);
    }
  }

  const primaryExpUnix = expirationsToFetch[0];
  const primaryExpDate = new Date(primaryExpUnix * 1000);
  const primaryDTE = Math.max(0, (primaryExpDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const T = Math.max(primaryDTE / 365, 1 / (365 * 24));

  const strikes: GexStrikeData[] = [];
  for (const [strike, data] of strikeMap) {
    const avgCallIV = data.callCount > 0 ? data.callIV / data.callCount : 0;
    const avgPutIV = data.putCount > 0 ? data.putIV / data.putCount : 0;

    const gex = calcStrikeGEX({
      spot,
      strike,
      callOI: data.callOI,
      putOI: data.putOI,
      callIV: avgCallIV,
      putIV: avgPutIV,
      callVolume: data.callVol,
      putVolume: data.putVol,
      T,
      riskFreeRate: 0.05,
    });
    strikes.push(gex);
  }

  strikes.sort((a, b) => a.strike - b.strike);

  const levels = findKeyLevels(strikes);
  const summary = calcSummary(strikes, spot);
  const fetchedAt = new Date().toISOString();

  const response: GexAnalysisResponse = {
    symbol,
    spot,
    fetchedAt,
    expirations: expirationStrings,
    analyzedExpiration,
    isAggregate,
    strikes,
    levels,
    summary,
  };

  cache.set(cacheKey, { data: response, fetchedAt: Date.now() });

  return response;
}

/**
 * Get stale cached data if available (for fallback on fetch errors).
 */
export function getStaleCacheEntry(
  symbol: string,
  expiration: string | null,
  aggregate: boolean,
): GexAnalysisResponse | null {
  const cacheKey = getCacheKey(symbol, expiration, aggregate);
  const cached = cache.get(cacheKey);
  return cached ? { ...cached.data, stale: true } : null;
}
