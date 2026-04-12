import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPolygonProvider } from "../../../services/research/providers/polygon.provider.js";
import type { MarketDataProvider } from "../../../services/research/providers/types.js";

describe("PolygonProvider", () => {
  let provider: MarketDataProvider;
  const originalEnv = process.env.MARKET_DATA_API_KEY;

  beforeEach(() => {
    process.env.MARKET_DATA_API_KEY = "test-key";
    provider = createPolygonProvider();
  });

  afterEach(() => {
    process.env.MARKET_DATA_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  describe("getQuote", () => {
    it("returns QuoteData for valid symbol", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({
          ticker: {
            lastTrade: { p: 150.5 },
            prevDay: { c: 148.0, o: 147.5, h: 151.0, l: 146.0, v: 5000000 },
            day: { o: 149.0, h: 152.0, l: 148.5, v: 3000000 },
          },
        }),
      } as Response);

      const quote = await provider.getQuote("AAPL");
      expect(quote.symbol).toBe("AAPL");
      expect(quote.last).toBe(150.5);
      expect(quote.close).toBe(148.0);
      expect(quote.open).toBe(149.0);
      expect(quote.volume).toBe(3000000);
    });

    it("throws when ticker is null", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ ticker: null }),
      } as Response);

      await expect(provider.getQuote("DELISTED")).rejects.toThrow("no ticker data");
    });

    it("returns null for missing nested fields", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ ticker: {} }),
      } as Response);

      const quote = await provider.getQuote("AAPL");
      expect(quote.last).toBeNull();
      expect(quote.close).toBeNull();
      expect(quote.open).toBeNull();
    });

    it("throws on API error response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false, status: 403,
        text: () => Promise.resolve("Forbidden"),
      } as Response);

      await expect(provider.getQuote("AAPL")).rejects.toThrow("403");
    });
  });

  describe("getHistoricalOHLCV", () => {
    it("transforms polygon response to OHLCV format", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({
          results: [
            { t: 1704067200000, o: 100, h: 105, l: 98, c: 103, v: 1000000 },
          ],
        }),
      } as Response);

      const result = await provider.getHistoricalOHLCV("AAPL", "2024-01-01", "2024-12-31");
      expect(result).toHaveLength(1);
      expect(result[0].open).toBe(100);
      expect(result[0].close).toBe(103);
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns empty array for no results", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.resolve({ results: null }),
      } as Response);

      const result = await provider.getHistoricalOHLCV("AAPL", "2024-01-01", "2024-12-31");
      expect(result).toEqual([]);
    });
  });

  describe("getOptionsChain", () => {
    it("throws not-supported error", async () => {
      await expect(provider.getOptionsChain("AAPL", 1)).rejects.toThrow(
        "Options chain not supported via Polygon — use IBKR"
      );
    });
  });

  describe("searchTickers", () => {
    it("returns enriched results with snapshot data", async () => {
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({
              results: [{ ticker: "AAPL", name: "Apple", market: "stocks", type: "CS", active: true }],
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            tickers: [{ ticker: "AAPL", lastTrade: { p: 150 }, prevDay: { c: 148 }, day: { v: 1000000 } }],
          }),
        } as Response);
      });

      const results = await provider.searchTickers({ market: "stocks" });
      expect(results).toHaveLength(1);
      expect(results[0].symbol).toBe("AAPL");
      expect(results[0].lastPrice).toBe(150);
    });

    it("returns results without enrichment on snapshot failure", async () => {
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({
              results: [{ ticker: "AAPL", name: "Apple", market: "stocks", type: "CS", active: true }],
            }),
          } as Response);
        }
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("Error") } as Response);
      });

      const results = await provider.searchTickers({ market: "stocks" });
      expect(results).toHaveLength(1);
      expect(results[0].lastPrice).toBeNull();
      expect(results[0].marketCap).toBeNull();
    });
  });
});
