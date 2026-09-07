import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchVix3m } from "../../../services/research/providers/yahoo.js";

describe("fetchVix3m", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns regularMarketPrice when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        chart: {
          result: [{ meta: { regularMarketPrice: 19.76, chartPreviousClose: 19.45 } }],
        },
      }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBe(19.76);
  });

  it("falls back to chartPreviousClose when regularMarketPrice is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        chart: {
          result: [{ meta: { chartPreviousClose: 19.45 } }],
        },
      }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBe(19.45);
  });

  it("returns null when chart.result is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ chart: { result: [] } }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null when meta is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ chart: { result: [{}] } }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null when price is zero or negative", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        chart: { result: [{ meta: { regularMarketPrice: 0 } }] },
      }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null on non-2xx HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({}),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network/timeout)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null when JSON parsing throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.reject(new Error("bad json")),
    } as unknown as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("sends a User-Agent header to avoid Yahoo's 403 on bare requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        chart: { result: [{ meta: { regularMarketPrice: 19.76 } }] },
      }),
    } as Response);

    await fetchVix3m();

    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBeTruthy();
  });
});
