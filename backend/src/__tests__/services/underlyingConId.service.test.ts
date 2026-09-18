/**
 * Underlying conId resolution.
 *
 * Regression cover for the spreads builder hang: TWS answers
 * reqContractDetails for SMART-routed stocks, but silently drops it for index
 * contracts (SPX/XSP/RUT on CBOE/RUSSELL) — no details, no end marker, no
 * error. The un-awaited promise never settled, so /api/spreads/expirations and
 * the SSE stream init hung forever and the builder never rendered.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveUnderlyingConId,
  clearUnderlyingConIdCache,
} from "../../services/underlyingConId.service.js";

/** A promise that never settles — models what TWS does for index contracts. */
const neverSettles = () => new Promise<never>(() => {});

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: true,
    getContractDetails: vi.fn(neverSettles),
    getMatchingSymbols: vi.fn(async () => [
      { contract: { conId: 416904, symbol: "SPX", secType: "IND", currency: "USD" } },
      { contract: { conId: 28140205, symbol: "SPXF", secType: "IND", currency: "USD" } },
    ]),
    ...overrides,
  } as any;
}

describe("resolveUnderlyingConId", () => {
  beforeEach(() => {
    clearUnderlyingConIdCache();
  });

  it("resolves an index conId without calling getContractDetails", async () => {
    const api = makeApi();

    const conId = await resolveUnderlyingConId(api, "SPX");

    expect(conId).toBe(416904);
    expect(api.getContractDetails).not.toHaveBeenCalled();
    expect(api.getMatchingSymbols).toHaveBeenCalledWith("SPX");
  });

  it("picks the exact symbol match, not a prefix match", async () => {
    const api = makeApi({
      getMatchingSymbols: vi.fn(async () => [
        { contract: { conId: 36400794, symbol: "XSPAM", secType: "IND", currency: "USD" } },
        { contract: { conId: 137851301, symbol: "XSP", secType: "IND", currency: "USD" } },
      ]),
    });

    expect(await resolveUnderlyingConId(api, "XSP")).toBe(137851301);
  });

  it("ignores same-named non-index matches for an index symbol", async () => {
    const api = makeApi({
      getMatchingSymbols: vi.fn(async () => [
        { contract: { conId: 999, symbol: "RUT", secType: "STK", currency: "USD" } },
        { contract: { conId: 416888, symbol: "RUT", secType: "IND", currency: "USD" } },
      ]),
    });

    expect(await resolveUnderlyingConId(api, "RUT")).toBe(416888);
  });

  it("caches a resolved conId instead of re-querying TWS", async () => {
    const api = makeApi();

    await resolveUnderlyingConId(api, "SPX");
    await resolveUnderlyingConId(api, "SPX");

    expect(api.getMatchingSymbols).toHaveBeenCalledTimes(1);
  });

  it("fails with an actionable error when no index match exists", async () => {
    const api = makeApi({ getMatchingSymbols: vi.fn(async () => []) });

    await expect(resolveUnderlyingConId(api, "SPX")).rejects.toThrow(
      /No index contract found for SPX/,
    );
  });

  it("does not cache a failed lookup", async () => {
    const api = makeApi({ getMatchingSymbols: vi.fn(async () => []) });
    await expect(resolveUnderlyingConId(api, "SPX")).rejects.toThrow();

    const good = makeApi();
    expect(await resolveUnderlyingConId(good, "SPX")).toBe(416904);
  });

  it("fails loudly instead of hanging when TWS never answers", async () => {
    const api = makeApi({ getMatchingSymbols: vi.fn(neverSettles) });

    await expect(resolveUnderlyingConId(api, "SPX", 50)).rejects.toThrow(
      /timed out after 50ms/,
    );
  });

  it("still uses getContractDetails for non-index symbols", async () => {
    const api = makeApi({
      getContractDetails: vi.fn(async () => [{ contract: { conId: 265598 } }]),
    });

    expect(await resolveUnderlyingConId(api, "AAPL")).toBe(265598);
    expect(api.getMatchingSymbols).not.toHaveBeenCalled();
  });

  it("fails loudly when a stock lookup returns nothing", async () => {
    const api = makeApi({ getContractDetails: vi.fn(async () => []) });

    await expect(resolveUnderlyingConId(api, "AAPL")).rejects.toThrow(
      /No contract details for AAPL/,
    );
  });
});
