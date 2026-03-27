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
  AnalystRating,
  TickerSearchResult,
} from "./types.js";

let provider: MarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (!provider) {
    const providerName = process.env.MARKET_DATA_PROVIDER || "auto";
    switch (providerName) {
      case "ibkr":
        provider = createIBKRProvider();
        break;
      case "polygon":
        provider = createPolygonProvider();
        break;
      case "auto": {
        if (ibkrService.isConnected()) {
          provider = createIBKRProvider();
        } else if (process.env.MARKET_DATA_API_KEY) {
          provider = createPolygonProvider();
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
    console.log(`Market data provider: ${provider.name}`);
  }
  return provider;
}

/**
 * Reset the cached provider so the next call to getMarketDataProvider()
 * re-evaluates availability (useful when IBKR connection state changes).
 */
export function resetMarketDataProvider(): void {
  provider = null;
}
