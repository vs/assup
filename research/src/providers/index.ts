import type { MarketDataProvider } from "./types.js";
import { createPolygonProvider } from "./polygon.provider.js";

export type { MarketDataProvider } from "./types.js";
export type {
  OHLCV,
  QuoteData,
  OptionsChainEntry,
  EarningsEvent,
  DividendEvent,
  AnalystRating,
} from "./types.js";

let provider: MarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (!provider) {
    const providerName = process.env.MARKET_DATA_PROVIDER || "polygon";
    switch (providerName) {
      case "polygon":
        provider = createPolygonProvider();
        break;
      default:
        throw new Error(`Unknown market data provider: ${providerName}`);
    }
    console.log(`Market data provider: ${provider.name}`);
  }
  return provider;
}
