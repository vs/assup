import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../services/research/db.js", () => ({
  prisma: { setting: { findUnique: vi.fn().mockResolvedValue(null) } },
}));

import { PolygonProvider, _resetRateLimiter } from "../../../services/research/providers/polygon.provider.js";
import { secFilingsCollector } from "../../../services/research/collectors/sec-filings.collector.js";
import { fetchSAMetrics } from "../../../services/research/collectors/sa-rapidapi.js";

/** A server that accepts the connection and then never answers. */
function stubSilentServer(): void {
  vi.stubGlobal("fetch", (_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
      );
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEARCH_HTTP_TIMEOUT_MS;
});

describe("outbound HTTP deadlines", () => {
  it("Polygon gives up on a request the server never answers", async () => {
    process.env.MARKET_DATA_API_KEY = "test-key";
    process.env.RESEARCH_HTTP_TIMEOUT_MS = "50";
    _resetRateLimiter();
    stubSilentServer();

    const provider = new PolygonProvider();
    await expect(
      provider.getHistoricalOHLCV("QZHI", "2025-09-18", "2026-09-18"),
    ).rejects.toThrow();
  }, 2_000);

  it("SEC EDGAR gives up on a request the server never answers", async () => {
    process.env.RESEARCH_HTTP_TIMEOUT_MS = "50";
    stubSilentServer();

    await expect(secFilingsCollector.collect("QZHI")).rejects.toThrow();
  }, 2_000);

  it("Seeking Alpha gives up on a request the server never answers", async () => {
    process.env.SA_RAPIDAPI_KEY = "test-key";
    process.env.RESEARCH_HTTP_TIMEOUT_MS = "50";
    stubSilentServer();

    await expect(fetchSAMetrics("QZHI", ["marketCap"])).resolves.toBeNull();
  }, 2_000);
});
