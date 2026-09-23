import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { greeksFromQuote } from "../../../services/quotes/optionGreeks.js";
import type { Quote } from "../../../services/quotes/quoteTypes.js";

const base: Quote = { key: "conId:1", status: "ok", updatedAt: 1 };
const put = { conId: 1, secType: "OPT", strike: 22, right: "P", lastTradeDateOrContractMonth: "20270115" };

describe("greeksFromQuote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("uses TWS delta and theta when both arrived", () => {
    expect(greeksFromQuote({ ...base, delta: -0.415, theta: -0.0084 }, put)).toEqual({ delta: -0.415, theta: -0.0084 });
  });

  it("computes Black-Scholes theta from IV and underlying when TWS sent no theta", () => {
    const g = greeksFromQuote({ ...base, delta: -0.415, iv: 0.52, undPrice: 22.32 }, put);
    expect(g?.delta).toBe(-0.415);
    expect(g?.theta).toBeLessThan(0);
    expect(g?.theta).toBeGreaterThan(-0.05);
  });

  it("returns theta null when it can't be computed", () => {
    expect(greeksFromQuote({ ...base, delta: -0.4 }, put)).toEqual({ delta: -0.4, theta: null });
    expect(greeksFromQuote({ ...base, delta: -0.4, iv: 0.5, undPrice: 22 }, { ...put, lastTradeDateOrContractMonth: "20260101" }))
      .toEqual({ delta: -0.4, theta: null });
  });

  it("returns null without a delta", () => {
    expect(greeksFromQuote({ ...base, theta: -0.01 }, put)).toBeNull();
  });
});
