import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shortInterestCollector } from "../../collectors/short-interest.collector.js";
import { mockFetchResponse, mockFetchError } from "../helpers/mock-fetch.js";
import type { SkippedCollection } from "../../collectors/types.js";

describe("shortInterestCollector", () => {
  const originalEnv = process.env.MARKET_DATA_API_KEY;

  beforeEach(() => {
    process.env.MARKET_DATA_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.MARKET_DATA_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(shortInterestCollector.source).toBe("short_interest");
    expect(shortInterestCollector.defaultSchedule).toBe("0 18 1,15 * *");
  });

  it("throws when MARKET_DATA_API_KEY not set", async () => {
    delete process.env.MARKET_DATA_API_KEY;
    await expect(shortInterestCollector.collect("AAPL")).rejects.toThrow("MARKET_DATA_API_KEY");
  });

  it("collects and transforms short interest data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      status: "OK",
      results: [
        { short_interest: 5000000, short_percent_of_float: 12.5, settlement_date: "2026-02-01", avg_daily_volume: 1000000 },
        { short_interest: 4500000, short_percent_of_float: 11.0, settlement_date: "2026-01-15", avg_daily_volume: 900000 },
      ],
    }));

    const result = await shortInterestCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("short_interest");
    const data = (result as any).data;
    expect(data.shortInterestShares).toBe(5000000);
    expect(data.shortPercentOfFloat).toBe(12.5);
    expect(data.daysToCover).toBe(5);
    expect(data.shortInterestTrend).toBe("increasing");
    expect(data.historicalEntries).toHaveLength(2);
  });

  it("returns SkippedCollection when API returns 403", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchError(403, "Forbidden"));
    const result = await shortInterestCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "short_interest",
    });
    expect((result as SkippedCollection).reason).toContain("403");
  });

  it("returns SkippedCollection when API returns 404", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchError(404, "Not Found"));
    const result = await shortInterestCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "short_interest",
    });
    expect((result as SkippedCollection).reason).toContain("404");
  });

  it("throws when API returns other errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchError(500, "Internal Server Error"));
    await expect(shortInterestCollector.collect("AAPL")).rejects.toThrow("500");
  });

  it("throws when no results returned", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({ status: "OK", results: [] }));
    await expect(shortInterestCollector.collect("AAPL")).rejects.toThrow("No short interest data");
  });

  it("throws when settlement_date is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      status: "OK",
      results: [{ short_interest: 5000000 }],
    }));
    await expect(shortInterestCollector.collect("AAPL")).rejects.toThrow("missing settlement_date");
  });

  it("uses date field as fallback for settlement_date", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      status: "OK",
      results: [{ short_interest: 5000000, date: "2026-02-01", avg_daily_volume: 1000000 }],
    }));

    const result = await shortInterestCollector.collect("AAPL");
    expect((result as any).data.settlementDate).toBe("2026-02-01");
  });

  it("computes trend as decreasing when short % drops > 5%", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      status: "OK",
      results: [
        { short_interest: 4000000, short_percent_of_float: 9.0, settlement_date: "2026-02-01", avg_daily_volume: 1000000 },
        { short_interest: 5000000, short_percent_of_float: 12.5, settlement_date: "2026-01-15", avg_daily_volume: 1000000 },
      ],
    }));

    const result = await shortInterestCollector.collect("AAPL");
    expect((result as any).data.shortInterestTrend).toBe("decreasing");
  });

  it("computes trend as unknown when previous shortPercentOfFloat is 0", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      status: "OK",
      results: [
        { short_interest: 5000000, short_percent_of_float: 10.0, settlement_date: "2026-02-01", avg_daily_volume: 1000000 },
        { short_interest: 0, short_percent_of_float: 0, settlement_date: "2026-01-15", avg_daily_volume: 1000000 },
      ],
    }));

    const result = await shortInterestCollector.collect("AAPL");
    expect((result as any).data.shortInterestTrend).toBe("unknown");
  });

  it("daysToCover is 0 when avgDailyVolume is 0", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      status: "OK",
      results: [
        { short_interest: 5000000, short_percent_of_float: 10, settlement_date: "2026-02-01", avg_daily_volume: 0 },
      ],
    }));

    const result = await shortInterestCollector.collect("AAPL");
    expect((result as any).data.daysToCover).toBe(0);
  });
});
