import { describe, it, expect, vi, afterEach } from "vitest";
import { PolygonProvider, _resetRateLimiter } from "../../../services/research/providers/polygon.provider.js";

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.POLYGON_RATE_LIMIT_RPM;
});

describe("Polygon request queue", () => {
  it("serves an interactive request before background work already queued", async () => {
    process.env.MARKET_DATA_API_KEY = "test-key";
    process.env.POLYGON_RATE_LIMIT_RPM = "60000"; // 1ms spacing: isolate ordering
    _resetRateLimiter();

    const served: string[] = [];
    let releaseFirst!: () => void;
    const firstInFlight = new Promise<void>((r) => (releaseFirst = r));

    vi.stubGlobal("fetch", async (url: string) => {
      served.push(new URL(url).pathname);
      if (served.length === 1) await firstInFlight;
      return okResponse({ results: [] });
    });

    const background = new PolygonProvider({ priority: "background" });
    const interactive = new PolygonProvider();

    // Three background refreshes: the first is in flight, two are queued
    const queued = [
      background.getDividendCalendar("AAA"),
      background.getDividendCalendar("BBB"),
      background.getDividendCalendar("CCC"),
    ];
    await new Promise((r) => setTimeout(r, 10));

    // A report collector asks for data while that backlog is waiting
    const pipeline = interactive.getHistoricalOHLCV("QZHI", "2025-09-18", "2026-09-18");

    releaseFirst();
    await Promise.all([...queued, pipeline]);

    expect(served[1]).toContain("/v2/aggs/ticker/QZHI");
  }, 5_000);
});
