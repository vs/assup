import { describe, it, expect, vi, afterEach } from "vitest";
import { seekingAlphaCollector } from "../../../services/research/collectors/seeking-alpha.collector.js";

describe("seekingAlphaCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects ratings and metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/rating/periods")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{ attributes: { ratings: { sellSideRating: 4.5 } }, meta: { period: 0, is_locked: true } }],
          }),
        } as Response);
      }
      if (urlStr.includes("/metrics")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              { attributes: { value: 25.5 }, relationships: { metric_type: { data: { id: "13" } } } },
            ],
            included: [
              { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("seeking_alpha");

    const data = (result as any).data;
    expect(data.ratings.data[0].attributes.ratings.sellSideRating).toBe(4.5);
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 25.5 });
  });

  it("succeeds when only ratings available", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/rating/periods")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [{ attributes: { ratings: { sellSideRating: 3.0 } }, meta: { period: 0 } }],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 500 } as Response);
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect((result as any).data.ratings).toBeDefined();
    expect((result as any).data.metrics).toBeNull();
  });

  it("flattens metrics correctly with multiple fields", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/rating/periods")) {
        return Promise.resolve({ ok: false, status: 500 } as Response);
      }
      if (urlStr.includes("/metrics")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: [
              { attributes: { value: 20.1 }, relationships: { metric_type: { data: { id: "13" } } } },
              { attributes: { value: 0.65 }, relationships: { metric_type: { data: { id: "36" } } } },
            ],
            included: [
              { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
              { id: "36", type: "metric_type", attributes: { field: "revenue_growth" } },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const result = await seekingAlphaCollector.collect("NVDA");
    const data = (result as any).data;
    expect(data.ratings).toBeNull();
    expect(data.metrics).toEqual({ pe_nongaap_fy1: 20.1, revenue_growth: 0.65 });
  });

  it("throws when both endpoints fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(seekingAlphaCollector.collect("AAPL")).rejects.toThrow("No Seeking Alpha data");
  });

  it("uses lowercase symbol slug in URLs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [{ attributes: { ratings: { sellSideRating: 4.0 } }, meta: { period: 0 } }] }),
    } as Response);

    await seekingAlphaCollector.collect("AAPL");

    const urls = fetchSpy.mock.calls.map((c) => (c[0] as string));
    expect(urls[0]).toContain("/symbols/aapl/");
    expect(urls[1]).toContain("filter[slugs]=aapl");
  });
});
