import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../services/research/collectors/sa-browser.js", () => ({
  fetchSAJson: vi.fn(),
}));

import { seekingAlphaCollector } from "../../../services/research/collectors/seeking-alpha.collector.js";
import { fetchSAJson } from "../../../services/research/collectors/sa-browser.js";

const mockFetchSA = vi.mocked(fetchSAJson);

describe("seekingAlphaCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects metrics", async () => {
    mockFetchSA.mockResolvedValue({
      data: [
        { attributes: { value: 25.5 }, relationships: { metric_type: { data: { id: "13" } } } },
      ],
      included: [
        { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
      ],
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect(result.source).toBe("seeking_alpha");

    const data = (result as any).data;
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 25.5 });
    expect(data.symbol).toBe("AAPL");
  });

  it("flattens metrics correctly with multiple fields", async () => {
    mockFetchSA.mockResolvedValue({
      data: [
        { attributes: { value: 20.1 }, relationships: { metric_type: { data: { id: "13" } } } },
        { attributes: { value: 0.65 }, relationships: { metric_type: { data: { id: "36" } } } },
      ],
      included: [
        { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
        { id: "36", type: "metric_type", attributes: { field: "revenue_growth" } },
      ],
    });

    const result = await seekingAlphaCollector.collect("NVDA");
    const data = (result as any).data;
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 20.1, revenue_growth: 0.65 });
  });

  it("returns null metrics when endpoint fails", async () => {
    mockFetchSA.mockResolvedValue(null);
    const result = await seekingAlphaCollector.collect("AAPL");
    const data = (result as any).data;
    expect(data.metrics).toBeNull();
  });

  it("uses lowercase symbol slug in URL", async () => {
    mockFetchSA.mockResolvedValue(null);

    await seekingAlphaCollector.collect("AAPL");

    expect(mockFetchSA).toHaveBeenCalledTimes(1);
    const url = mockFetchSA.mock.calls[0][0] as string;
    expect(url).toContain("filter[slugs]=aapl");
  });

  it("includes fetchedAt in returned data", async () => {
    mockFetchSA.mockResolvedValue(null);

    const result = await seekingAlphaCollector.collect("AAPL");
    const data = (result as any).data;
    expect(data.fetchedAt).toBeDefined();
  });
});
