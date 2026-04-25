import { ibkrService } from "./ibkr.js";
import { Bar, BarSizeSetting, WhatToShow, Stock } from "@stoqey/ib";

interface PricePoint {
  date: string;
  close: number;
}

interface CacheEntry {
  data: PricePoint[];
  timestamp: number;
}

interface QueuedRequest {
  symbol: string;
  resolve: (data: PricePoint[]) => void;
  reject: (error: Error) => void;
  duration?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_DELAY_MS = 50; // Delay between TWS requests
const MAX_CONCURRENT_REQUESTS = 3; // Max parallel historical data requests

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
      this.requestQueue.push({ symbol, resolve, reject });
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
      });
      this.processQueue();
    });
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
        const cacheKey = this.getCacheKey(request.symbol);

        // Re-check cache (another request may have populated it)
        const cached = this.cache.get(cacheKey);
        if (cached && this.isCacheValid(cached)) {
          request.resolve(cached.data);
          continue;
        }

        this.activeRequests++;

        // Process this request without awaiting - allow parallelism
        this.fetchFromTWS(request.symbol, request.duration)
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

  private async fetchFromTWS(symbol: string, duration = "1 M"): Promise<PricePoint[]> {
    if (!ibkrService.isConnected()) {
      throw new Error("Not connected to TWS");
    }

    const contract = new Stock(symbol.toUpperCase(), "SMART", "USD");

    // Daily bars for sparklines (up to 1 month), weekly bars for longer durations
    const barSize = duration === "1 M" || duration === "7 D"
      ? BarSizeSetting.DAYS_ONE
      : BarSizeSetting.WEEKS_ONE;

    // Try TRADES first, fallback to MIDPOINT if we get a warning
    const whatToShowOptions = [WhatToShow.TRADES, WhatToShow.MIDPOINT];

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
