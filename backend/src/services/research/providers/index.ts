import type { MarketDataProvider } from "./types.js";
import { createPolygonProvider } from "./polygon.provider.js";
import { createIBKRProvider } from "./ibkr.provider.js";
import { ibkrService } from "../../ibkr.js";

export type { MarketDataProvider } from "./types.js";
export type {
  OHLCV,
  QuoteData,
  OptionsChainEntry,
  EarningsEvent,
  DividendEvent,
  TickerSearchResult,
} from "./types.js";

let cachedProvider: MarketDataProvider | null = null;

function getIBKRProvider(): MarketDataProvider | null {
  if (ibkrService.isConnected()) {
    return createIBKRProvider();
  }
  return null;
}

function getPolygonProvider(): MarketDataProvider | null {
  if (process.env.MARKET_DATA_API_KEY) {
    return createPolygonProvider();
  }
  return null;
}

function createFallbackProvider(primary: MarketDataProvider, fallback: MarketDataProvider): MarketDataProvider {
  return {
    name: `${primary.name}→${fallback.name}`,
    async getQuote(symbol) {
      try { return await primary.getQuote(symbol); }
      catch { return fallback.getQuote(symbol); }
    },
    async getHistoricalOHLCV(symbol, from, to, timespan) {
      try { return await primary.getHistoricalOHLCV(symbol, from, to, timespan); }
      catch { return fallback.getHistoricalOHLCV(symbol, from, to, timespan); }
    },
    async getOptionsChain(symbol, expirations) {
      try { return await primary.getOptionsChain(symbol, expirations); }
      catch { return fallback.getOptionsChain(symbol, expirations); }
    },
    async getEarningsCalendar(symbol) {
      try { return await primary.getEarningsCalendar(symbol); }
      catch { return fallback.getEarningsCalendar(symbol); }
    },
    async getDividendCalendar(symbol) {
      try { return await primary.getDividendCalendar(symbol); }
      catch { return fallback.getDividendCalendar(symbol); }
    },
    async searchTickers(criteria) {
      try { return await primary.searchTickers(criteria); }
      catch { return fallback.searchTickers(criteria); }
    },
  };
}

export function getMarketDataProvider(): MarketDataProvider {
  if (cachedProvider) return cachedProvider;

  const providerName = process.env.MARKET_DATA_PROVIDER || "auto";

  switch (providerName) {
    case "ibkr":
      cachedProvider = createIBKRProvider();
      break;
    case "polygon":
      cachedProvider = createPolygonProvider();
      break;
    case "auto": {
      const ibkr = getIBKRProvider();
      const polygon = getPolygonProvider();

      if (ibkr && polygon) {
        cachedProvider = createFallbackProvider(ibkr, polygon);
      } else if (ibkr) {
        cachedProvider = ibkr;
      } else if (polygon) {
        cachedProvider = polygon;
      } else {
        throw new Error(
          "No market data provider available: IBKR not connected and MARKET_DATA_API_KEY not set"
        );
      }
      break;
    }
    default:
      throw new Error(`Unknown market data provider: ${providerName}`);
  }

  console.log(`Market data provider: ${cachedProvider.name}`);
  return cachedProvider;
}

/**
 * Reset the cached provider so the next call to getMarketDataProvider()
 * re-evaluates availability (useful when IBKR connection state changes).
 */
export function resetMarketDataProvider(): void {
  cachedProvider = null;
}
