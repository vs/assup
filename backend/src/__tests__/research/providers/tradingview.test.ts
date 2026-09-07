import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchVix3m } from "../../../services/research/providers/tradingview.js";

describe("fetchVix3m", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the close value for CBOE:VIX3M when the scanner responds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        data: [{ s: "CBOE:VIX3M", d: [16.82] }],
      }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBe(16.82);
  });

  it("returns null when CBOE:VIX3M row is missing from the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ data: [] }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null when close is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        data: [{ s: "CBOE:VIX3M", d: [null] }],
      }),
    } as Response);

    const result = await fetchVix3m();
    expect(result).toBeNull();
  });

  it("returns null when close is zero or negative", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({
        data: [{ s: "CBOE:VIX3M", d: [0] }],
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
});
