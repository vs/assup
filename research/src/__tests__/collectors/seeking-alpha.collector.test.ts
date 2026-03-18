import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { seekingAlphaCollector } from "../../collectors/seeking-alpha.collector.js";

describe("seekingAlphaCollector", () => {
  const originalEnv = process.env.SEEKING_ALPHA_API_KEY;

  beforeEach(() => {
    process.env.SEEKING_ALPHA_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.SEEKING_ALPHA_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws when API key not set", async () => {
    delete process.env.SEEKING_ALPHA_API_KEY;
    await expect(seekingAlphaCollector.collect("AAPL")).rejects.toThrow("SEEKING_ALPHA_API_KEY");
  });

  it("collects ratings and metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const body = urlStr.includes("ratings")
        ? { data: { attributes: { quantRating: "buy" } } }
        : { data: [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect(result.source).toBe("seeking_alpha");
    expect(result.data.ratings).toBeDefined();
    expect(result.data.metrics).toBeDefined();
  });

  it("succeeds when only ratings available", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("ratings")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: {} }) } as Response);
      }
      return Promise.resolve({ ok: false, status: 500 } as Response);
    });

    const result = await seekingAlphaCollector.collect("AAPL");
    expect(result.data.ratings).toBeDefined();
    expect(result.data.metrics).toBeNull();
  });

  it("throws when both endpoints fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(seekingAlphaCollector.collect("AAPL")).rejects.toThrow("No Seeking Alpha data");
  });
});
