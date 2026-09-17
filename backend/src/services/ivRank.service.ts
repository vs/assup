import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import { historicalDataService } from "./historicalData.js";
import type { IvRankInfo, IvRankUnavailableReason } from "@assup/shared";

const TARGET_WINDOW_DAYS = 252;
const MIN_WINDOW_DAYS = 126;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface IvPoint {
  date: string;
  iv: number;
}

export interface IvRankResult {
  info: IvRankInfo | null;
  /** Non-null exactly when `info` is null. */
  reason: IvRankUnavailableReason | null;
}

/**
 * IBKR reports OPTION_IMPLIED_VOLATILITY bar closes as decimals (0.341 = 34.1%).
 * This is the single point of unit normalization — if live TWS turns out to
 * report percent instead, divide by 100 here and nowhere else.
 */
function normalizeIv(rawClose: number): number {
  return rawClose;
}

function unavailable(reason: IvRankUnavailableReason): IvRankResult {
  return { info: null, reason };
}

class IvRankService {
  /**
   * Pure: rank the last point of a series against its own window.
   * Returns a reason rather than any substituted value on every failure path.
   */
  computeFromSeries(series: IvPoint[]): IvRankResult {
    const clean = series.filter((p) => Number.isFinite(p.iv) && p.iv > 0);
    if (clean.length === 0) return unavailable("no_iv_data");

    const window = clean.slice(-TARGET_WINDOW_DAYS);
    if (window.length < MIN_WINDOW_DAYS) return unavailable("insufficient_history");

    const values = window.map((p) => p.iv);
    const iv52wLow = Math.min(...values);
    const iv52wHigh = Math.max(...values);
    if (iv52wHigh === iv52wLow) return unavailable("degenerate_range");

    const last = window[window.length - 1];

    return {
      info: {
        ivRank: ((last.iv - iv52wLow) / (iv52wHigh - iv52wLow)) * 100,
        currentIv: last.iv,
        iv52wLow,
        iv52wHigh,
        windowDays: window.length,
        asOf: last.date,
      },
      reason: null,
    };
  }

  async getIvRank(symbol: string): Promise<IvRankResult> {
    const upper = symbol.toUpperCase();

    const cached = await prisma.ivHistoryCache.findUnique({
      where: { symbol: upper },
    });

    if (cached && cached.expiresAt > new Date()) {
      return this.computeFromSeries(cached.data as unknown as IvPoint[]);
    }

    if (!ibkrService.isConnected()) {
      // A stale series still beats no answer; only fall back to it when we
      // genuinely cannot refresh.
      if (cached) return this.computeFromSeries(cached.data as unknown as IvPoint[]);
      return unavailable("tws_disconnected");
    }

    const fetched = await historicalDataService.getImpliedVolatilityHistory(upper);

    // A failure is not an answer. Leave the cache untouched so the next call
    // retries, rather than recording "no IV" for a symbol we simply could not ask
    // about. Reported as no_iv_data because that is what the caller can act on.
    if (fetched.kind === "failed") {
      console.warn(`IV history fetch failed for ${upper}:`, fetched.error);
      return unavailable("no_iv_data");
    }

    const series: IvPoint[] =
      fetched.kind === "data"
        ? fetched.bars.map((b) => ({ date: b.date, iv: normalizeIv(b.close) }))
        : [];

    // An empty series is cached deliberately. TWS has told us this symbol has no
    // IV history, and without recording that verdict every profile request and
    // every batch background refresh would re-query TWS forever, occupying the
    // shared request throttle on a question already answered.
    {
      const now = new Date();
      await prisma.ivHistoryCache.upsert({
        where: { symbol: upper },
        create: {
          symbol: upper,
          data: series as unknown as object,
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
        },
        update: {
          data: series as unknown as object,
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
        },
      });
    }

    return this.computeFromSeries(series);
  }

  /** Read-only: compute from cache without ever contacting TWS. */
  async getIvRankCachedOnly(symbol: string): Promise<IvRankResult & { stale: boolean }> {
    const upper = symbol.toUpperCase();
    const cached = await prisma.ivHistoryCache.findUnique({ where: { symbol: upper } });
    if (!cached) return { ...unavailable("no_iv_data"), stale: false };
    return {
      ...this.computeFromSeries(cached.data as unknown as IvPoint[]),
      stale: cached.expiresAt <= new Date(),
    };
  }
}

export const ivRankService = new IvRankService();
