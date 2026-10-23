/**
 * GEX (Gamma Exposure) calculation service.
 *
 * Fetches options chain data from Yahoo Finance (via yahoo-finance2),
 * calculates Black-Scholes gamma per contract, computes GEX per strike,
 * and identifies key dealer positioning levels (put wall, call wall, GEX flip).
 */

import YahooFinance from "yahoo-finance2";
import type {
  GexAnalysisResponse,
  GexStrikeData,
  GexKeyLevels,
  GexSummary,
  GexProfileResponse,
  GexProfileStrike,
  GexProfilePoint,
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

// --- Expiry Timing ---

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
/** Floor for live contracts so gamma stays finite in the last minutes before the close. */
const MIN_T_YEARS = 1 / (365 * 24);

const etHourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hourCycle: "h23",
});
const etDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/** Calendar date (YYYY-MM-DD) in New York for a UTC timestamp. */
export function etDateString(ms: number): string {
  return etDateFormat.format(ms);
}

/** UTC timestamp of the 4:00 PM ET close on an ISO date (YYYY-MM-DD), DST-aware. */
export function marketCloseMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const edtClose = Date.UTC(y, m - 1, d, 20); // 16:00 EDT
  return Number(etHourFormat.format(edtClose)) === 16 ? edtClose : edtClose + 60 * 60 * 1000;
}

/**
 * Time to expiry in years, measured to the 4 PM ET close of the expiration date.
 * Returns 0 once the contract has expired.
 */
export function yearsToExpiry(isoDate: string, nowMs: number): number {
  const ms = marketCloseMs(isoDate) - nowMs;
  if (ms <= 0) return 0;
  return Math.max(ms / MS_PER_YEAR, MIN_T_YEARS);
}

/** Yahoo stamps expirations at 00:00 UTC of the expiration date. */
function yahooExpiryToIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().split("T")[0];
}

// --- Implied Volatility ---

/**
 * Yahoo reports IV = 0.00001 when its solver fails (typically ITM contracts).
 * No index option trades anywhere near this, so anything at or below is a placeholder.
 */
const YAHOO_IV_PLACEHOLDER_MAX = 0.001;

export function isUsableIV(iv: number): boolean {
  return Number.isFinite(iv) && iv > YAHOO_IV_PLACEHOLDER_MAX;
}

/**
 * IV for one side of a strike. When Yahoo has no usable IV for it, use the
 * opposite side at the same strike/expiry: put-call parity gives European
 * calls and puts the same IV. Returns 0 (no gamma) when neither is usable.
 */
export function resolveIV(own: number, opposite: number): number {
  if (isUsableIV(own)) return own;
  if (isUsableIV(opposite)) return opposite;
  return 0;
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
 * @param spot - Current underlying price, used to filter to a relevant range.
 */
export function findKeyLevels(strikes: GexStrikeData[], spot: number): GexKeyLevels {
  if (strikes.length === 0) {
    return {
      putWall: { strike: 0, oi: 0 },
      callWall: { strike: 0, oi: 0 },
      gexFlip: null,
      maxPositiveGEX: { strike: 0, gex: 0 },
      maxNegativeGEX: { strike: 0, gex: 0 },
    };
  }

  // Only consider strikes within ±20% of spot for meaningful levels.
  // Deep OTM strikes have noise-level GEX that produces spurious crossings.
  const minStrike = spot * 0.80;
  const maxStrike = spot * 1.20;
  const relevant = strikes.filter(s => s.strike >= minStrike && s.strike <= maxStrike);
  const pool = relevant.length > 0 ? relevant : strikes;

  // Put wall: strike with highest put OI
  let putWall = pool[0];
  for (const s of pool) {
    if (s.putOI > putWall.putOI) putWall = s;
  }

  // Call wall: strike with highest call OI
  let callWall = pool[0];
  for (const s of pool) {
    if (s.callOI > callWall.callOI) callWall = s;
  }

  // Max positive and negative GEX
  let maxPos = pool[0];
  let maxNeg = pool[0];
  for (const s of pool) {
    if (s.netGEX > maxPos.netGEX) maxPos = s;
    if (s.netGEX < maxNeg.netGEX) maxNeg = s;
  }

  // GEX flip: nearest zero-crossing to spot (search outward from spot)
  let gexFlip: number | null = null;
  const sorted = [...pool].sort((a, b) => a.strike - b.strike);

  // Find the index closest to spot, then search outward in both directions
  let spotIdx = 0;
  let spotDist = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const d = Math.abs(sorted[i].strike - spot);
    if (d < spotDist) { spotDist = d; spotIdx = i; }
  }

  // Search downward from spot (put side)
  for (let i = spotIdx; i > 0; i--) {
    const a = sorted[i - 1];
    const b = sorted[i];
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

  // If no flip found below spot, search upward (call side)
  if (gexFlip === null) {
    for (let i = spotIdx; i < sorted.length - 1; i++) {
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

  const levels = findKeyLevels(strikes, spot);

  return {
    totalPutOI,
    totalCallOI,
    putCallRatio: Math.round(putCallRatio * 100) / 100,
    netGEXRegime,
    gexFlipLevel: levels.gexFlip,
  };
}

// --- GEX Profile (all expiries vs ex-0DTE) ---

export interface GexContract {
  strike: number;
  openInterest: number;
  iv: number;       // decimal
  T: number;        // years
  isCall: boolean;
  zeroDte: boolean;
}

/** Dealer GEX of one contract if the underlying traded at `price` ($ per 1% move). */
export function contractGEX(c: GexContract, price: number): number {
  const gex = c.openInterest * bsGamma(price, c.strike, c.iv, c.T) * 100 * price * price * 0.01;
  return c.isCall ? gex : -gex;
}

/**
 * Zero-crossing of `values` (sampled at ascending `xs`) nearest to `spot`,
 * linearly interpolated. Null when the series never changes sign.
 */
export function findZeroCrossing(xs: number[], values: number[], spot: number): number | null {
  let best: number | null = null;
  for (let i = 1; i < xs.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
      const x = xs[i - 1] + (-a / (b - a)) * (xs[i] - xs[i - 1]);
      if (best === null || Math.abs(x - spot) < Math.abs(best - spot)) best = x;
    }
  }
  return best === null ? null : Math.round(best * 100) / 100;
}

export interface GexProfile {
  strikes: GexProfileStrike[];
  profile: GexProfilePoint[];
  netAtSpot: { all: number; exZeroDte: number; zeroDte: number };
  flip: { all: number | null; exZeroDte: number | null };
  largestZeroDteStrike: number | null;
}

/**
 * Build per-strike GEX at spot (bars) and total GEX across hypothetical spots
 * within ±rangePct (lines), for all expiries and with 0DTE removed.
 */
export function buildGexProfile(
  contracts: GexContract[],
  spot: number,
  rangePct: number,
  gridSteps: number,
): GexProfile {
  const live = contracts.filter((c) => c.openInterest > 0 && c.iv > 0 && c.T > 0);
  const lo = spot * (1 - rangePct);
  const hi = spot * (1 + rangePct);

  const byStrike = new Map<number, GexProfileStrike>();
  let all = 0;
  let zeroDte = 0;
  for (const c of live) {
    const gex = contractGEX(c, spot);
    all += gex;
    if (c.zeroDte) zeroDte += gex;
    if (c.strike < lo || c.strike > hi) continue;
    const entry = byStrike.get(c.strike) ?? { strike: c.strike, netGEX: 0, zeroDteGEX: 0 };
    entry.netGEX += gex;
    if (c.zeroDte) entry.zeroDteGEX += gex;
    byStrike.set(c.strike, entry);
  }
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);

  const profile: GexProfilePoint[] = [];
  for (let i = 0; i <= gridSteps; i++) {
    const price = lo + ((hi - lo) * i) / gridSteps;
    let net = 0;
    let net0 = 0;
    for (const c of live) {
      const gex = contractGEX(c, price);
      net += gex;
      if (c.zeroDte) net0 += gex;
    }
    profile.push({ price, netGEX: net, netGEXExZeroDte: net - net0 });
  }

  const xs = profile.map((p) => p.price);
  const flip = {
    all: findZeroCrossing(xs, profile.map((p) => p.netGEX), spot),
    exZeroDte: findZeroCrossing(xs, profile.map((p) => p.netGEXExZeroDte), spot),
  };

  let largestZeroDteStrike: number | null = null;
  let largestAbs = 0;
  for (const s of strikes) {
    if (Math.abs(s.zeroDteGEX) > largestAbs) {
      largestAbs = Math.abs(s.zeroDteGEX);
      largestZeroDteStrike = s.strike;
    }
  }

  return {
    strikes,
    profile,
    netAtSpot: { all, exZeroDte: all - zeroDte, zeroDte },
    flip,
    largestZeroDteStrike,
  };
}

// --- Yahoo Finance Fetch (via yahoo-finance2) ---

export interface ChainContract {
  strike: number;
  openInterest: number;
  volume: number;
  impliedVolatility: number;
  bid: number;
  ask: number;
}

interface OptionsChainResult {
  spot: number;
  spotTime: Date | null;
  expirationDates: number[];
  options: Array<{
    expirationDate: number;
    calls: ChainContract[];
    puts: ChainContract[];
  }>;
}

const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
});

/**
 * Fetch options chain for a single expiration via yahoo-finance2.
 * The library handles crumb/cookie auth automatically.
 */
async function fetchOptionsChain(
  yahooSymbol: string,
  expirationDate?: Date,
): Promise<OptionsChainResult> {
  const result = await yf.options(
    yahooSymbol,
    expirationDate ? { date: expirationDate } : {},
  );

  const spot = (result as any).quote?.regularMarketPrice ?? 0;
  const spotTime: Date | null = (result as any).quote?.regularMarketTime ?? null;
  const expirationDates = ((result as any).expirationDates ?? []).map(
    (d: Date) => Math.floor(d.getTime() / 1000),
  );

  const options = ((result as any).options ?? []).map((opt: any) => ({
    expirationDate: Math.floor(new Date(opt.expirationDate).getTime() / 1000),
    calls: (opt.calls ?? []).map((c: any) => ({
      strike: c.strike ?? 0,
      openInterest: c.openInterest ?? 0,
      volume: c.volume ?? 0,
      impliedVolatility: c.impliedVolatility ?? 0,
      bid: c.bid ?? 0,
      ask: c.ask ?? 0,
    })),
    puts: (opt.puts ?? []).map((p: any) => ({
      strike: p.strike ?? 0,
      openInterest: p.openInterest ?? 0,
      volume: p.volume ?? 0,
      impliedVolatility: p.impliedVolatility ?? 0,
      bid: p.bid ?? 0,
      ask: p.ask ?? 0,
    })),
  }));

  return { spot, spotTime, expirationDates, options };
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
function isCacheValid(entry: { fetchedAt: number }): boolean {
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

  const initial = await fetchOptionsChain(yahooSymbol);
  if (initial.spot <= 0) throw new Error(`No options data for ${symbol} (${yahooSymbol})`);

  const spot = initial.spot;
  const expirationDates = initial.expirationDates;

  const expirationStrings = expirationDates.map(yahooExpiryToIso);

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
    if (initial.options.length > 0) {
      const firstOpts = initial.options[0];
      expirationsToFetch = [firstOpts.expirationDate];
      const d = new Date(firstOpts.expirationDate * 1000);
      analyzedExpiration = d.toISOString().split("T")[0];
    }
  }

  const allOptions: OptionsChainResult["options"] = [];

  for (let i = 0; i < expirationsToFetch.length; i++) {
    const expUnix = expirationsToFetch[i];
    const existing = initial.options.find((o) => o.expirationDate === expUnix);
    if (existing) {
      allOptions.push(existing);
    } else {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, AGGREGATE_FETCH_DELAY_MS));
      }
      const resp = await fetchOptionsChain(yahooSymbol, new Date(expUnix * 1000));
      const opts = resp.options[0];
      if (opts) allOptions.push(opts);
    }
  }

  // Calculate GEX per-expiration with its own T, then sum across expirations.
  // This is critical because gamma is extremely sensitive to time-to-expiry —
  // a 0-DTE option has much higher gamma than a 7-DTE option at the same strike.
  const gexAccumulator = new Map<number, GexStrikeData>();

  for (const opts of allOptions) {
    const T = yearsToExpiry(yahooExpiryToIso(opts.expirationDate), Date.now());

    // Build a per-strike map for this expiration
    const strikeData = new Map<number, { callOI: number; putOI: number; callVol: number; putVol: number; callIV: number; putIV: number }>();

    for (const call of opts.calls) {
      const entry = strikeData.get(call.strike) ?? { callOI: 0, putOI: 0, callVol: 0, putVol: 0, callIV: 0, putIV: 0 };
      entry.callOI += call.openInterest ?? 0;
      entry.callVol += call.volume ?? 0;
      entry.callIV = call.impliedVolatility ?? 0;
      strikeData.set(call.strike, entry);
    }

    for (const put of opts.puts) {
      const entry = strikeData.get(put.strike) ?? { callOI: 0, putOI: 0, callVol: 0, putVol: 0, callIV: 0, putIV: 0 };
      entry.putOI += put.openInterest ?? 0;
      entry.putVol += put.volume ?? 0;
      entry.putIV = put.impliedVolatility ?? 0;
      strikeData.set(put.strike, entry);
    }

    // Calculate GEX for this expiration and accumulate
    for (const [strike, data] of strikeData) {
      const gex = calcStrikeGEX({
        spot,
        strike,
        callOI: data.callOI,
        putOI: data.putOI,
        callIV: resolveIV(data.callIV, data.putIV),
        putIV: resolveIV(data.putIV, data.callIV),
        callVolume: data.callVol,
        putVolume: data.putVol,
        T,
        riskFreeRate: 0.05,
      });

      const existing = gexAccumulator.get(strike);
      if (existing) {
        existing.callOI += gex.callOI;
        existing.putOI += gex.putOI;
        existing.callVolume += gex.callVolume;
        existing.putVolume += gex.putVolume;
        existing.callGEX += gex.callGEX;
        existing.putGEX += gex.putGEX;
        existing.netGEX += gex.netGEX;
      } else {
        gexAccumulator.set(strike, { ...gex });
      }
    }
  }

  const strikes: GexStrikeData[] = [...gexAccumulator.values()];

  strikes.sort((a, b) => a.strike - b.strike);

  const levels = findKeyLevels(strikes, spot);
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

// --- GEX Profile (all expiries) ---

/** Near-the-money window used to decide whether Yahoo is quoting the chain. */
const LIVE_QUOTE_WINDOW_PCT = 0.02;

/**
 * Whether an expiration has live quotes: at least one contract within ±2% of
 * spot with a non-zero bid or ask. After the close Yahoo zeroes bid/ask and its
 * IVs fall back to placeholders (0.00001, 1/256, 1/64, ...), which are unusable.
 */
export function hasLiveQuotes(calls: ChainContract[], puts: ChainContract[], spot: number): boolean {
  const lo = spot * (1 - LIVE_QUOTE_WINDOW_PCT);
  const hi = spot * (1 + LIVE_QUOTE_WINDOW_PCT);
  return [...calls, ...puts].some((c) => c.strike >= lo && c.strike <= hi && (c.bid > 0 || c.ask > 0));
}

const PROFILE_RANGE_PCT = 0.05;
const PROFILE_GRID_STEPS = 160;
const PROFILE_FETCH_CONCURRENCY = 4;

const profileCache = new Map<string, { data: GexProfileResponse; fetchedAt: number }>();

/**
 * Dealer gamma across every listed expiration: per-strike GEX at spot plus the
 * net GEX curve over hypothetical spots, for all expiries and ex-0DTE.
 */
export async function getGexProfile(symbol: string, forceRefresh = false): Promise<GexProfileResponse> {
  if (!forceRefresh) {
    const cached = profileCache.get(symbol);
    if (cached && isCacheValid(cached)) return cached.data;
  }

  const yahooSymbol = toYahooSymbol(symbol);
  const initial = await fetchOptionsChain(yahooSymbol);
  if (initial.spot <= 0) throw new Error(`No options data for ${symbol} (${yahooSymbol})`);
  if (!initial.spotTime) throw new Error(`Yahoo quote for ${symbol} (${yahooSymbol}) has no regularMarketTime`);

  const spot = initial.spot;
  const nowMs = Date.now();
  const today = etDateString(nowMs);
  const expirations = initial.expirationDates.filter(
    (ts) => yearsToExpiry(yahooExpiryToIso(ts), nowMs) > 0,
  );
  if (expirations.length === 0) throw new Error(`No unexpired option expirations for ${symbol} (${yahooSymbol})`);

  const chains: OptionsChainResult["options"] = new Array(expirations.length);
  let next = 0;
  const worker = async () => {
    while (next < expirations.length) {
      const i = next++;
      const ts = expirations[i];
      const existing = initial.options.find((o) => o.expirationDate === ts);
      if (existing) {
        chains[i] = existing;
        continue;
      }
      const resp = await fetchOptionsChain(yahooSymbol, new Date(ts * 1000));
      const opts = resp.options[0];
      if (!opts) {
        throw new Error(`Yahoo returned no options for ${symbol} expiration ${yahooExpiryToIso(ts)}; retry with refresh=true`);
      }
      chains[i] = opts;
    }
  };
  await Promise.all(Array.from({ length: PROFILE_FETCH_CONCURRENCY }, worker));

  const nearest = chains[0];
  if (!hasLiveQuotes(nearest.calls, nearest.puts, spot)) {
    throw new Error(
      `Yahoo has no live option quotes for ${symbol}: bid and ask are 0 on every contract within ` +
      `±${LIVE_QUOTE_WINDOW_PCT * 100}% of spot for ${yahooExpiryToIso(nearest.expirationDate)}, so its implied ` +
      `volatilities are placeholders. This happens after the close until quotes resume before the next open.`,
    );
  }

  const contracts: GexContract[] = [];
  let zeroDteExpiration: string | null = null;
  let contractsWithoutIV = 0;
  for (const opts of chains) {
    const iso = yahooExpiryToIso(opts.expirationDate);
    const T = yearsToExpiry(iso, nowMs);
    const zeroDte = iso === today;
    if (zeroDte) zeroDteExpiration = iso;
    const callIV = new Map(opts.calls.map((c) => [c.strike, c.impliedVolatility]));
    const putIV = new Map(opts.puts.map((p) => [p.strike, p.impliedVolatility]));
    const add = (strike: number, openInterest: number, ownIV: number, oppositeIV: number, isCall: boolean) => {
      const iv = resolveIV(ownIV, oppositeIV);
      if (iv === 0 && openInterest > 0) contractsWithoutIV++;
      contracts.push({ strike, openInterest, iv, T, isCall, zeroDte });
    };
    for (const c of opts.calls) add(c.strike, c.openInterest, c.impliedVolatility, putIV.get(c.strike) ?? 0, true);
    for (const p of opts.puts) add(p.strike, p.openInterest, p.impliedVolatility, callIV.get(p.strike) ?? 0, false);
  }

  const profile = buildGexProfile(contracts, spot, PROFILE_RANGE_PCT, PROFILE_GRID_STEPS);
  const response: GexProfileResponse = {
    symbol,
    spot,
    spotTime: new Date(initial.spotTime).toISOString(),
    fetchedAt: new Date(nowMs).toISOString(),
    expirationCount: chains.length,
    zeroDteExpiration,
    rangePct: PROFILE_RANGE_PCT,
    contractsWithoutIV,
    ...profile,
  };

  profileCache.set(symbol, { data: response, fetchedAt: nowMs });
  return response;
}

/** Stale cached profile, if any (fallback on fetch errors), tagged with why it is stale. */
export function getStaleProfileCacheEntry(symbol: string, reason: string): GexProfileResponse | null {
  const cached = profileCache.get(symbol);
  return cached ? { ...cached.data, stale: true, staleReason: reason } : null;
}
