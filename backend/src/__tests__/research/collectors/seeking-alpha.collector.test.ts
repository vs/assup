// backend/src/__tests__/research/collectors/seeking-alpha.collector.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../services/research/collectors/sa-rapidapi.js", () => ({
  fetchSAMetrics: vi.fn(),
}));

import { seekingAlphaCollector } from "../../../services/research/collectors/seeking-alpha.collector.js";
import { fetchSAMetrics } from "../../../services/research/collectors/sa-rapidapi.js";

const mockFetchMetrics = vi.mocked(fetchSAMetrics);

describe("seekingAlphaCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects metrics", async () => {
    mockFetchMetrics.mockResolvedValue({ pe_nongaap_fy1: 25.5 });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect(result.source).toBe("seeking_alpha");

    const data = (result as any).data;
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 25.5 });
    expect(data.symbol).toBe("AAPL");
  });

  it("returns multiple metrics", async () => {
    mockFetchMetrics.mockResolvedValue({ pe_nongaap_fy1: 20.1, revenue_growth: 0.65 });

    const result = await seekingAlphaCollector.collect("NVDA");
    const data = (result as any).data;
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 20.1, revenue_growth: 0.65 });
  });

  it("returns null metrics when endpoint fails", async () => {
    mockFetchMetrics.mockResolvedValue(null);
    const result = await seekingAlphaCollector.collect("AAPL");
    const data = (result as any).data;
    expect(data.metrics).toBeNull();
  });

  it("passes correct fields to fetchSAMetrics", async () => {
    mockFetchMetrics.mockResolvedValue(null);
    await seekingAlphaCollector.collect("AAPL");

    expect(mockFetchMetrics).toHaveBeenCalledWith("AAPL", [
      "pe_nongaap_fy1",
      "dividend_yield",
      "div_yield_fwd",
      "revenue_growth",
      "marketcap",
    ]);
  });

  it("includes fetchedAt in returned data", async () => {
    mockFetchMetrics.mockResolvedValue(null);
    const result = await seekingAlphaCollector.collect("AAPL");
    const data = (result as any).data;
    expect(data.fetchedAt).toBeDefined();
  });
});
