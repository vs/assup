/**
 * Spread Strategy Advisor service.
 *
 * Computes VIX-based metrics for enhanced put credit spread strike selection:
 *   - Fetches VIX, VIX3M, 10-day realized vol of the underlying
 *   - Evaluates entry filters (IV/HV ratio, VIX term structure, cooloff)
 *   - Recommends short strike distance, wing width, position sizing
 *
 * Works for all spread-eligible index symbols (SPX, XSP, RUT).
 */

import { Contract, SecType, BarSizeSetting, WhatToShow } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { prisma } from "../db/index.js";
import { isMarketOpen } from "../utils/market.js";

// --- Strategy constants ---

const SD_MULTIPLE = 2.0;
const DEFAULT_WING_WIDTH = 30;       // SPX points (scaled for other symbols)
const IV_HV_THRESHOLD = 0.8;
const VIX_TERM_THRESHOLD = 0.95;
const POSITION_MULT_MIN = 0.5;
const POSITION_MULT_MAX = 2.0;
const COOLOFF_DAYS = 3;              // trading days to skip after a loss
const HV_LOOKBACK = 10;             // days for realized vol calculation
const SETTINGS_KEY = "spreadStrategy";

// --- Symbol-specific configuration ---

interface SymbolStrategyConfig {
  /** IND symbol for the underlying price (e.g. "SPX") */
  priceSymbol: string;
  /** VIX-equivalent symbol for this underlying's IV */
  vixSymbol: string;
  /** 3-month VIX-equivalent symbol */
  vix3mSymbol: string;
  /** Strike rounding increment */
  strikeIncrement: number;
  /** Default wing width in underlying points */
  wingWidth: number;
}

const SYMBOL_STRATEGY_CONFIG: Record<string, SymbolStrategyConfig> = {
  SPX: {
    priceSymbol: "SPX",
    vixSymbol: "VIX",
    vix3mSymbol: "VIX3M",
    strikeIncrement: 5,
    wingWidth: 30,
  },
  XSP: {
    priceSymbol: "SPX",          // XSP = SPX / 10
    vixSymbol: "VIX",
    vix3mSymbol: "VIX3M",
    strikeIncrement: 1,
    wingWidth: 3,                // 30 SPX points / 10
  },
  RUT: {
    priceSymbol: "RUT",
    vixSymbol: "RVX",
    vix3mSymbol: "RVX",          // No widely-available RVX 3M; use RVX itself
    strikeIncrement: 5,
    wingWidth: 20,
  },
};

// --- Types ---

export interface StrategyFilter {
  name: string;
  passed: boolean;
  reason: string;
  value: number | null;
  threshold: number | null;
}

export interface StrategyMetrics {
  symbol: string;

  // Market data
  underlyingPrice: number | null;
  spotVix: number | null;
  vix3m: number | null;
  hv10: number | null;
  ivHvRatio: number | null;

  // Filters
  filters: StrategyFilter[];
  allFiltersPassed: boolean;

  // Recommendations (null when filters don't pass)
  dailyMovePct: number | null;
  recommendedShortStrike: number | null;
  recommendedLongStrike: number | null;
  wingWidth: number;
  positionMultiplier: number | null;

  // Cooloff state
  cooloffActive: boolean;
  cooloffUntil: string | null;       // ISO date string
  lastLossDate: string | null;

  // Expiry guidance
  recommendedExpiry: "0DTE" | "1DTE" | null;

  // Timestamps
  computedAt: string;
}

// --- Helpers ---

function makeIndexContract(symbol: string): Contract {
  return { symbol, secType: SecType.IND, exchange: "CBOE", currency: "USD" };
}

/**
 * Compute 10-day annualized realized volatility from daily close prices.
 * Returns percentage (e.g. 15.2 for 15.2% vol).
 */
function computeRealizedVol(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;

  const recent = closes.slice(-lookback - 1);
  const logReturns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] <= 0) return null;
    logReturns.push(Math.log(recent[i] / recent[i - 1]));
  }

  if (logReturns.length < lookback) return null;

  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  const dailyVol = Math.sqrt(variance);

  return dailyVol * Math.sqrt(252) * 100;
}

/**
 * Round a strike down to the nearest increment.
 */
function roundStrikeDown(price: number, increment: number): number {
  return Math.floor(price / increment) * increment;
}

/**
 * Count trading days (weekdays) between two dates, exclusive of both endpoints.
 */
function tradingDaysBetween(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  current.setDate(current.getDate() + 1);
  while (current < to) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Add N trading days to a date.
 */
function addTradingDays(from: Date, n: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < n) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

// --- Service ---

class SpreadStrategyService {

  /**
   * Compute strategy metrics for a given symbol.
   */
  async getMetrics(symbol: string): Promise<StrategyMetrics> {
    const config = SYMBOL_STRATEGY_CONFIG[symbol];
    if (!config) {
      throw new Error(`Symbol ${symbol} is not supported for strategy metrics. Supported: ${Object.keys(SYMBOL_STRATEGY_CONFIG).join(", ")}`);
    }

    const computedAt = new Date().toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay(); // 0=Sun, 5=Fri

    // Switch to live/frozen data for accurate reads
    const dataType = isMarketOpen() ? 1 : 2;
    try { ibkrService.setMarketDataType(dataType as 1 | 2); } catch { /* ignore */ }

    // Fetch market data in parallel
    const [underlyingData, vixData, vix3mData, historicalBars] = await Promise.all([
      ibkrService.getMarketData(makeIndexContract(config.priceSymbol)).catch(() => null),
      ibkrService.getMarketData(makeIndexContract(config.vixSymbol)).catch(() => null),
      config.vix3mSymbol !== config.vixSymbol
        ? ibkrService.getMarketData(makeIndexContract(config.vix3mSymbol)).catch(() => null)
        : Promise.resolve(null),
      this.fetchHistoricalCloses(config.priceSymbol),
    ]);

    // Restore delayed data type
    try { ibkrService.setMarketDataType(3); } catch { /* ignore */ }

    // Extract prices. IBKR returns 0 (or -1) as a sentinel for missing data
    // — most commonly when no market data subscription covers the contract
    // (e.g., VIX3M). Treat non-positive values as null so downstream filters
    // report "missing data" instead of comparing against 0.
    const positivePrice = (v: number | null | undefined): number | null =>
      v != null && v > 0 ? v : null;

    let underlyingPrice = positivePrice(underlyingData?.last) ?? positivePrice(underlyingData?.close);
    const spotVix = positivePrice(vixData?.last) ?? positivePrice(vixData?.close);
    let vix3m = positivePrice(vix3mData?.last) ?? positivePrice(vix3mData?.close);

    // For XSP, divide SPX price by 10
    if (symbol === "XSP" && underlyingPrice != null) {
      underlyingPrice = underlyingPrice / 10;
    }

    // If VIX3M is unavailable (RUT case), fall back to spot VIX
    if (vix3m == null && config.vix3mSymbol === config.vixSymbol) {
      vix3m = spotVix;
    }

    // Compute HV10
    const hv10 = computeRealizedVol(historicalBars, HV_LOOKBACK);

    // Compute IV/HV ratio
    const ivHvRatio = (spotVix != null && hv10 != null && hv10 > 0)
      ? spotVix / hv10
      : null;

    // Load cooloff state
    const { cooloffActive, cooloffUntil, lastLossDate } = await this.getCooloffState(symbol);

    // --- Evaluate filters ---
    const filters: StrategyFilter[] = [];

    // Filter 1: IV/HV ratio
    filters.push({
      name: "IV/HV Ratio",
      passed: ivHvRatio != null ? ivHvRatio >= IV_HV_THRESHOLD : false,
      reason: ivHvRatio == null
        ? "Cannot compute: missing VIX or HV data"
        : ivHvRatio < IV_HV_THRESHOLD
          ? `IV/HV ratio ${ivHvRatio.toFixed(2)} < ${IV_HV_THRESHOLD}: market realizing more vol than priced`
          : `IV/HV ratio ${ivHvRatio.toFixed(2)} >= ${IV_HV_THRESHOLD}: implied vol is rich relative to realized`,
      value: ivHvRatio != null ? Math.round(ivHvRatio * 100) / 100 : null,
      threshold: IV_HV_THRESHOLD,
    });

    // Filter 2: VIX term structure
    const termStructurePassed = (spotVix != null && vix3m != null)
      ? spotVix <= vix3m * VIX_TERM_THRESHOLD
      : false;
    filters.push({
      name: "VIX Term Structure",
      passed: termStructurePassed,
      reason: spotVix == null || vix3m == null
        ? "Cannot compute: missing VIX or VIX3M data"
        : !termStructurePassed
          ? `VIX ${spotVix.toFixed(1)} > VIX3M×${VIX_TERM_THRESHOLD} (${(vix3m * VIX_TERM_THRESHOLD).toFixed(1)}): inverted term structure signals sustained stress`
          : `VIX ${spotVix.toFixed(1)} <= VIX3M×${VIX_TERM_THRESHOLD} (${(vix3m * VIX_TERM_THRESHOLD).toFixed(1)}): normal contango`,
      value: spotVix,
      threshold: vix3m != null ? Math.round(vix3m * VIX_TERM_THRESHOLD * 10) / 10 : null,
    });

    // Filter 3: Cooloff
    filters.push({
      name: "Cooloff Period",
      passed: !cooloffActive,
      reason: cooloffActive
        ? `Loss occurred recently — cooloff active until ${cooloffUntil}`
        : lastLossDate
          ? `Cooloff cleared (last loss: ${lastLossDate})`
          : "No recent losses",
      value: null,
      threshold: COOLOFF_DAYS,
    });

    const allFiltersPassed = filters.every(f => f.passed);

    // --- Recommendations ---
    let dailyMovePct: number | null = null;
    let recommendedShortStrike: number | null = null;
    let recommendedLongStrike: number | null = null;
    let positionMultiplier: number | null = null;

    if (spotVix != null && underlyingPrice != null) {
      dailyMovePct = Math.round((spotVix / Math.sqrt(252) * SD_MULTIPLE) * 100) / 100;

      const rawShort = underlyingPrice * (1 - dailyMovePct / 100);
      recommendedShortStrike = roundStrikeDown(rawShort, config.strikeIncrement);
      recommendedLongStrike = recommendedShortStrike - config.wingWidth;
    }

    if (ivHvRatio != null) {
      positionMultiplier = Math.round(Math.min(POSITION_MULT_MAX, Math.max(POSITION_MULT_MIN, ivHvRatio)) * 100) / 100;
    }

    // Expiry guidance
    const recommendedExpiry: "0DTE" | "1DTE" | null =
      dayOfWeek === 5 ? "0DTE" : (dayOfWeek >= 1 && dayOfWeek <= 4) ? "1DTE" : null;

    return {
      symbol,
      underlyingPrice,
      spotVix,
      vix3m,
      hv10: hv10 != null ? Math.round(hv10 * 100) / 100 : null,
      ivHvRatio,
      filters,
      allFiltersPassed,
      dailyMovePct,
      recommendedShortStrike,
      recommendedLongStrike,
      wingWidth: config.wingWidth,
      positionMultiplier,
      cooloffActive,
      cooloffUntil,
      lastLossDate,
      recommendedExpiry,
      computedAt,
    };
  }

  /**
   * Record a loss for cooloff tracking.
   */
  async recordLoss(symbol: string, lossDate?: string): Promise<void> {
    const date = lossDate ?? new Date().toISOString().split("T")[0];
    const state = await this.loadState();
    if (!state.losses) state.losses = {};
    state.losses[symbol] = date;
    await this.saveState(state);
  }

  /**
   * Clear cooloff for a symbol.
   */
  async clearCooloff(symbol: string): Promise<void> {
    const state = await this.loadState();
    if (state.losses) {
      delete state.losses[symbol];
    }
    await this.saveState(state);
  }

  // --- Private helpers ---

  private async fetchHistoricalCloses(symbol: string): Promise<number[]> {
    if (!ibkrService.isConnected()) return [];

    try {
      const bars = await ibkrService.getHistoricalData({
        contract: makeIndexContract(symbol),
        endDateTime: "",
        duration: "1 M",
        barSizeSetting: BarSizeSetting.DAYS_ONE,
        whatToShow: WhatToShow.TRADES,
        useRth: true,
        formatDate: 1,
      });

      if (!Array.isArray(bars)) return [];
      return bars
        .filter(b => b.close != null && b.close > 0)
        .map(b => b.close!);
    } catch {
      return [];
    }
  }

  private async getCooloffState(symbol: string): Promise<{
    cooloffActive: boolean;
    cooloffUntil: string | null;
    lastLossDate: string | null;
  }> {
    const state = await this.loadState();
    const lastLossDateStr = state.losses?.[symbol] ?? null;

    if (!lastLossDateStr) {
      return { cooloffActive: false, cooloffUntil: null, lastLossDate: null };
    }

    const lossDate = new Date(lastLossDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cooloffEnd = addTradingDays(lossDate, COOLOFF_DAYS);
    const cooloffActive = today <= cooloffEnd;

    return {
      cooloffActive,
      cooloffUntil: cooloffActive ? cooloffEnd.toISOString().split("T")[0] : null,
      lastLossDate: lastLossDateStr,
    };
  }

  private async loadState(): Promise<Record<string, any>> {
    const setting = await prisma.setting.findUnique({
      where: { key: SETTINGS_KEY },
    });
    return (setting?.value as Record<string, any>) ?? {};
  }

  private async saveState(state: Record<string, any>): Promise<void> {
    await prisma.setting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: state },
      update: { value: state },
    });
  }
}

export const spreadStrategyService = new SpreadStrategyService();
