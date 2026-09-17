import { ibkrService } from "./ibkr.js";
import { Bar, BarSizeSetting, WhatToShow, Stock, Contract, SecType } from "@stoqey/ib";

interface PricePoint {
  date: string;
  close: number;
}

interface CacheEntry {
  data: PricePoint[];
  timestamp: number;
}

/**
 * The outcome of an implied-volatility history request.
 *
 * `no_data` is TWS's authoritative verdict that the series does not exist for
 * this contract (an empty response, or error 162). `failed` means we could not
 * get an answer at all. Callers must not conflate them: a `no_data` verdict is
 * worth caching so the symbol is not re-queried forever, whereas caching a
 * `failed` would suppress a perfectly good symbol until the entry expired.
 */
export type IvHistoryResult =
  | { kind: "data"; bars: PricePoint[] }
  | { kind: "no_data" }
  | { kind: "failed"; error: unknown };

interface QueuedRequest {
  symbol: string;
  resolve: (data: PricePoint[]) => void;
  reject: (error: Error) => void;
  duration?: string;
  whatToShow?: WhatToShow;
  cacheKey?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_DELAY_MS = 50; // Delay between TWS requests
const MAX_CONCURRENT_REQUESTS = 3; // Max parallel historical data requests

// Indices (SPX, XSP, RUT, VIX, etc.) need SecType.IND, not STK
const INDEX_SYMBOLS = new Set(["SPX", "XSP", "RUT", "VIX", "DJX", "NDX"]);

function buildUnderlyingContract(symbol: string): Contract {
  const sym = symbol.toUpperCase();
  return INDEX_SYMBOLS.has(sym)
    ? { symbol: sym, secType: SecType.IND, exchange: "CBOE", currency: "USD" }
    : new Stock(sym, "SMART", "USD");
}

class HistoricalDataService {
  private cache: Map<string, CacheEntry> = new Map();
  private requestQueue: QueuedRequest[] = [];
  private activeRequests = 0;
  private isProcessing = false;

  private getCacheKey(symbol: string): string {
    return symbol.toUpperCase();
  }

  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  async getSparklineData(symbol: string): Promise<PricePoint[]> {
    const cacheKey = this.getCacheKey(symbol);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ symbol, resolve, reject, cacheKey });
      this.processQueue();
    });
  }

  async getLongTermData(symbol: string, duration = "3 Y"): Promise<PricePoint[]> {
    const cacheKey = `${this.getCacheKey(symbol)}:${duration}`;

    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        symbol,
        resolve: (data) => {
          this.cache.set(cacheKey, { data, timestamp: Date.now() });
          resolve(data);
        },
        reject,
        duration,
        cacheKey,
      });
      this.processQueue();
    });
  }

  /**
   * Daily ATM implied-volatility bars for the underlying, one year back.
   * Returns an empty array when TWS is disconnected or the symbol has no
   * IV series — callers distinguish those cases themselves.
   */
  async getImpliedVolatilityHistory(symbol: string): Promise<IvHistoryResult> {
    if (!ibkrService.isConnected()) {
      return { kind: "failed", error: new Error("Not connected to TWS") };
    }

    const cacheKey = `${this.getCacheKey(symbol)}:IV`;
    const cached = this.cache.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      return cached.data.length > 0
        ? { kind: "data", bars: cached.data }
        : { kind: "no_data" };
    }

    const bars = await new Promise<PricePoint[]>((resolve, reject) => {
      this.requestQueue.push({
        symbol,
        duration: "1 Y",
        whatToShow: WhatToShow.OPTION_IMPLIED_VOLATILITY,
        resolve: (data) => {
          this.cache.set(cacheKey, { data, timestamp: Date.now() });
          resolve(data);
        },
        reject,
        cacheKey,
      });
      this.processQueue();
    }).catch((error: unknown) => {
      // Distinguished below: a rejection means the request failed, which is not
      // the same as TWS answering "this series does not exist".
      return { __failed: error } as const;
    });

    if (bars && typeof bars === "object" && "__failed" in bars) {
      return { kind: "failed", error: bars.__failed };
    }

    return bars.length > 0 ? { kind: "data", bars } : { kind: "no_data" };
  }

  async getBatchSparklineData(
    symbols: string[]
  ): Promise<Map<string, PricePoint[]>> {
    const results = new Map<string, PricePoint[]>();

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const data = await this.getSparklineData(symbol);
          results.set(symbol.toUpperCase(), data);
        } catch (error) {
          console.warn(`Failed to get sparkline for ${symbol}:`, error);
          results.set(symbol.toUpperCase(), []);
        }
      })
    );

    return results;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    const processNext = async () => {
      while (this.requestQueue.length > 0 && this.activeRequests < MAX_CONCURRENT_REQUESTS) {
        const request = this.requestQueue.shift()!;
        const cacheKey = request.cacheKey ?? this.getCacheKey(request.symbol);

        // Re-check cache (another request may have populated it)
        const cached = this.cache.get(cacheKey);
        if (cached && this.isCacheValid(cached)) {
          request.resolve(cached.data);
          continue;
        }

        this.activeRequests++;

        // Process this request without awaiting - allow parallelism
        this.fetchFromTWS(request.symbol, request.duration, request.whatToShow)
          .then((data) => {
            this.cache.set(cacheKey, { data, timestamp: Date.now() });
            request.resolve(data);
          })
          .catch((error) => {
            request.reject(error as Error);
          })
          .finally(() => {
            this.activeRequests--;
            // Small delay then process more
            setTimeout(() => processNext(), REQUEST_DELAY_MS);
          });
      }
    };

    await processNext();

    // Wait for all active requests to complete before marking as not processing
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.activeRequests > 0 || this.requestQueue.length > 0) {
          setTimeout(check, 50);
        } else {
          resolve();
        }
      };
      check();
    });
    this.isProcessing = false;
  }

  private async fetchFromTWS(
    symbol: string,
    duration = "1 M",
    whatToShowOverride?: WhatToShow,
  ): Promise<PricePoint[]> {
    if (!ibkrService.isConnected()) {
      throw new Error("Not connected to TWS");
    }

    const contract = buildUnderlyingContract(symbol);

    // Weekly bars for sparklines (1 year), daily for short durations
    const barSize = whatToShowOverride
      ? BarSizeSetting.DAYS_ONE
      : duration === "1 M" || duration === "7 D"
        ? BarSizeSetting.DAYS_ONE
        : BarSizeSetting.WEEKS_ONE;

    // Price requests try TRADES then MIDPOINT. An explicit whatToShow (IV) has no
    // alternative series, so it gets exactly one attempt.
    const whatToShowOptions = whatToShowOverride
      ? [whatToShowOverride]
      : [WhatToShow.TRADES, WhatToShow.MIDPOINT];

    for (const whatToShow of whatToShowOptions) {
      try {
        const bars = await ibkrService.getHistoricalData({
          contract,
          endDateTime: "",
          duration,
          barSizeSetting: barSize,
          whatToShow,
          useRth: true,
          formatDate: 1,
        });

        // Validate response is an array
        if (!Array.isArray(bars) || bars.length === 0) {
          console.debug(
            `No data returned for ${symbol} with ${whatToShow}, trying next option`
          );
          continue;
        }

        return bars
          .filter((bar: Bar) => bar.time && bar.close !== undefined)
          .map((bar: Bar) => ({
            date: bar.time!,
            close: bar.close!,
          }));
      } catch (error: unknown) {
        const err = error as { code?: number; error?: { message?: string } };

        // Code 2176 is fractional shares warning - the library treats it as error
        // but data might still be partially available. Try next whatToShow option.
        if (err.code === 2176) {
          console.debug(
            `TWS warning for ${symbol} with ${whatToShow}, trying next option`
          );
          continue;
        }

        // Code 162 is "HMDS query returned no data": TWS is telling us the series
        // does not exist for this contract. That is the same benign verdict as the
        // empty-response branch above — many symbols simply have no options — so it
        // gets the same severity rather than an error-level stack trace.
        if (err.code === 162) {
          console.debug(`No ${whatToShow} history for ${symbol} (TWS 162)`);
          return [];
        }

        // A genuine failure. IV callers need to tell "this does not exist" apart
        // from "we could not ask", so surface it instead of returning an empty
        // array they would cache as an authoritative "no data".
        if (whatToShowOverride) {
          throw error;
        }

        // For other errors, log and return empty
        console.error(`Historical data fetch failed for ${symbol}:`, error);
        return [];
      }
    }

    // All options exhausted
    console.warn(`Could not fetch historical data for ${symbol} with any method`);
    return [];
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; symbols: string[] } {
    return {
      size: this.cache.size,
      symbols: Array.from(this.cache.keys()),
    };
  }
}

export const historicalDataService = new HistoricalDataService();
