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

  it("collects ratings and metrics", async () => {
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/rating/periods")) {
        return {
          data: [{ attributes: { ratings: { sellSideRating: 4.5 } }, meta: { period: 0, is_locked: true } }],
        };
      }
      if (url.includes("/metrics")) {
        return {
          data: [
            { attributes: { value: 25.5 }, relationships: { metric_type: { data: { id: "13" } } } },
          ],
          included: [
            { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
          ],
        };
      }
      return null;
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("seeking_alpha");

    const data = (result as any).data;
    expect(data.ratings.data[0].attributes.ratings.sellSideRating).toBe(4.5);
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 25.5 });
  });

  it("succeeds when only ratings available", async () => {
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/rating/periods")) {
        return {
          data: [{ attributes: { ratings: { sellSideRating: 3.0 } }, meta: { period: 0 } }],
        };
      }
      return null;
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect((result as any).data.ratings).toBeDefined();
    expect((result as any).data.metrics).toBeNull();
  });

  it("flattens metrics correctly with multiple fields", async () => {
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/metrics")) {
        return {
          data: [
            { attributes: { value: 20.1 }, relationships: { metric_type: { data: { id: "13" } } } },
            { attributes: { value: 0.65 }, relationships: { metric_type: { data: { id: "36" } } } },
          ],
          included: [
            { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
            { id: "36", type: "metric_type", attributes: { field: "revenue_growth" } },
          ],
        };
      }
      return null;
    });

    const result = await seekingAlphaCollector.collect("NVDA");
    const data = (result as any).data;
    expect(data.ratings).toBeNull();
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 20.1, revenue_growth: 0.65 });
  });

  it("returns null ratings and metrics when both endpoints fail", async () => {
    mockFetchSA.mockResolvedValue(null);
    const result = await seekingAlphaCollector.collect("AAPL");
    const data = (result as any).data;
    expect(data.ratings).toBeNull();
    expect(data.metrics).toBeNull();
  });

  it("uses lowercase symbol slug in URLs", async () => {
    mockFetchSA.mockResolvedValue({
      data: [{ attributes: { ratings: { sellSideRating: 4.0 } }, meta: { period: 0 } }],
    });

    await seekingAlphaCollector.collect("AAPL");

    const urls = mockFetchSA.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain("/symbols/aapl/");
    expect(urls[1]).toContain("filter[slugs]=aapl");
  });
});
