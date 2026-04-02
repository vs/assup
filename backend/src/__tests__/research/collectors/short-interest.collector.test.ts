// backend/src/__tests__/research/collectors/short-interest.collector.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SkippedCollection } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/research/collectors/sa-rapidapi.js", () => ({
  fetchSAMetrics: vi.fn(),
}));

import { shortInterestCollector } from "../../../services/research/collectors/short-interest.collector.js";
import { fetchSAMetrics } from "../../../services/research/collectors/sa-rapidapi.js";

const mockFetchMetrics = vi.mocked(fetchSAMetrics);

describe("shortInterestCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(shortInterestCollector.source).toBe("short_interest");
    expect(shortInterestCollector.defaultSchedule).toBe("0 18 * * 1-5");
  });

  it("returns collected data with shortPercentOfSO", async () => {
    mockFetchMetrics.mockResolvedValue({ short_interest_shares_outstanding: 0.042 });

    const result = await shortInterestCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("short_interest");
    const data = (result as any).data;
    expect(data.shortPercentOfSO).toBe(0.042);
    expect(data.symbol).toBe("AAPL");
    expect(data.daysToCover).toBe(0);
    expect(data.shortInterestTrend).toBe("unknown");
  });

  it("returns SkippedCollection when fetchSAMetrics returns null", async () => {
    mockFetchMetrics.mockResolvedValue(null);
    const result = await shortInterestCollector.collect("AAPL");
    expect(result).toMatchObject({ _tag: "skipped", source: "short_interest" });
    expect((result as SkippedCollection).reason).toContain("Seeking Alpha");
  });

  it("returns SkippedCollection when metric is missing", async () => {
    mockFetchMetrics.mockResolvedValue({ pe_nongaap_fy1: 25 });
    const result = await shortInterestCollector.collect("XYZ");
    expect(result).toMatchObject({ _tag: "skipped", source: "short_interest" });
  });

  it("passes correct field to fetchSAMetrics", async () => {
    mockFetchMetrics.mockResolvedValue(null);
    await shortInterestCollector.collect("AAPL");
    expect(mockFetchMetrics).toHaveBeenCalledWith("AAPL", ["short_interest_shares_outstanding"]);
  });
});
