import { describe, it, expect } from "vitest";
import {
  quoteKey,
  subscribeContract,
  applyTicks,
  quotePrice,
  hasField,
  statusForError,
} from "../../../services/quotes/quoteKey.js";
import type { Quote } from "../../../services/quotes/quoteTypes.js";

const ticks = (entries: Array<[number, number | undefined]>) =>
  new Map(entries.map(([k, v]) => [k, { value: v }]));

const emptyQuote = (): Quote => ({ key: "k", status: "pending", updatedAt: null });

describe("quoteKey", () => {
  it("keys by conId when present, regardless of other fields", () => {
    expect(quoteKey({ conId: 786955716, secType: "OPT", symbol: "ZUL", strike: 25 })).toBe("conId:786955716");
    expect(quoteKey({ conId: 786955716, secType: "OPT" })).toBe("conId:786955716");
  });

  it("keys a spec without conId, normalizing right and multiplier", () => {
    const put = {
      symbol: "ZUL", secType: "OPT", lastTradeDateOrContractMonth: "20260918",
      strike: 25, right: "PUT", multiplier: "100", tradingClass: "ZUL", exchange: "AMEX",
    };
    expect(quoteKey(put)).toBe("spec:OPT:ZUL:20260918:25:P:ZUL:100");
    expect(quoteKey({ ...put, right: "P", multiplier: 100, exchange: "SMART" })).toBe(quoteKey(put));
    expect(quoteKey({ symbol: "ZUL", secType: "STK" })).toBe("spec:STK:ZUL:::::");
  });

  it("treats conId 0 as absent", () => {
    expect(quoteKey({ conId: 0, symbol: "ZUL", secType: "STK" })).toBe("spec:STK:ZUL:::::");
  });
});

describe("subscribeContract", () => {
  it("sends only conId + SMART for options and stocks with a conId", () => {
    expect(subscribeContract({ conId: 1, secType: "OPT", symbol: "ZUL", exchange: "AMEX", strike: 25 }))
      .toEqual({ conId: 1, exchange: "SMART" });
    expect(subscribeContract({ conId: 2, secType: "STK", symbol: "ZUL", exchange: "NYSE" }))
      .toEqual({ conId: 2, exchange: "SMART" });
  });

  it("keeps the exchange for indexes (SPX on SMART is error 200)", () => {
    expect(subscribeContract({ conId: 416904, secType: "IND", symbol: "SPX", exchange: "CBOE" }))
      .toEqual({ conId: 416904, exchange: "CBOE" });
  });

  it("routes a spec through SMART and normalizes right", () => {
    expect(subscribeContract({
      symbol: "ZUL", secType: "OPT", lastTradeDateOrContractMonth: "20260918",
      strike: 25, right: "PUT", multiplier: 100, tradingClass: "ZUL", exchange: "AMEX", currency: "USD",
    })).toEqual({
      symbol: "ZUL", secType: "OPT", exchange: "SMART", currency: "USD",
      lastTradeDateOrContractMonth: "20260918", strike: 25, right: "P", multiplier: 100, tradingClass: "ZUL",
    });
    expect(subscribeContract({ symbol: "SPX", secType: "IND", exchange: "CBOE" }))
      .toEqual({ symbol: "SPX", secType: "IND", exchange: "CBOE", currency: "USD" });
  });
});

describe("applyTicks", () => {
  it("prefers live ticks over delayed ones", () => {
    const q = emptyQuote();
    applyTicks(q, ticks([[1, 2.61], [66, 2.5], [2, 2.77], [67, 2.9], [4, 2.59], [9, 2.66], [14, 2.7], [8, 120]]), 1000);
    expect(q).toMatchObject({ bid: 2.61, ask: 2.77, last: 2.59, close: 2.66, open: 2.7, volume: 120, updatedAt: 1000 });
  });

  it("falls back to delayed ticks", () => {
    const q = emptyQuote();
    applyTicks(q, ticks([[66, 1.1], [67, 1.2], [68, 1.15], [75, 1.0], [76, 1.05], [74, 5]]), 1);
    expect(q).toMatchObject({ bid: 1.1, ask: 1.2, last: 1.15, close: 1.0, open: 1.05, volume: 5 });
  });

  it("records bid/ask -1 as no market instead of a price, and keeps bid 0", () => {
    const q = emptyQuote();
    applyTicks(q, ticks([[1, -1], [2, 0.05]]), 1);
    expect(q.bid).toBeUndefined();
    expect(q.noMarket).toEqual(["bid"]);
    applyTicks(q, ticks([[1, 0], [2, 0.05]]), 2);
    expect(q.bid).toBe(0);
    expect(q.noMarket).toEqual([]);
  });

  it("maps model greeks with bid-computation fallback and ignores undecoded sentinels", () => {
    const q = emptyQuote();
    applyTicks(q, ticks([[10041, -0.415], [10044, -0.0084], [10039, 0.52], [10002, 22.32]]), 1);
    expect(q).toMatchObject({ delta: -0.415, theta: -0.0084, iv: 0.52, undPrice: 22.32 });

    const b = emptyQuote();
    applyTicks(b, ticks([[10005, -0.3], [10008, -0.01], [10003, 0.4], [10041, undefined]]), 1);
    expect(b).toMatchObject({ delta: -0.3, theta: -0.01, iv: 0.4 });
  });

  it("does not erase earlier values when a later update omits a tick", () => {
    const q = emptyQuote();
    applyTicks(q, ticks([[1, 2.6], [2, 2.7]]), 1);
    applyTicks(q, ticks([[4, 2.65]]), 2);
    expect(q).toMatchObject({ bid: 2.6, ask: 2.7, last: 2.65, updatedAt: 2 });
  });
});

describe("quotePrice / hasField", () => {
  it("uses last, then close; ignores non-positive values (SPX bid/ask are 0)", () => {
    expect(quotePrice({ ...emptyQuote(), last: 7633.69, close: 7551.81, bid: 0, ask: 0 })).toBe(7633.69);
    expect(quotePrice({ ...emptyQuote(), last: 0, close: 7551.81 })).toBe(7551.81);
    expect(quotePrice({ ...emptyQuote(), bid: 1, ask: 2 })).toBeUndefined();
  });

  it("reports field presence, with price virtual", () => {
    const q: Quote = { ...emptyQuote(), bid: 0, close: 5 };
    expect(hasField(q, "bid")).toBe(true);
    expect(hasField(q, "ask")).toBe(false);
    expect(hasField(q, "price")).toBe(true);
    expect(hasField(q, "delta")).toBe(false);
  });
});

describe("statusForError", () => {
  it("maps TWS error codes to quote statuses", () => {
    expect(statusForError(200)).toBe("no-contract");
    expect(statusForError(10091)).toBe("not-subscribed");
    expect(statusForError(10089)).toBe("not-subscribed");
    expect(statusForError(354)).toBe("not-subscribed");
    expect(statusForError(101)).toBe("no-lines");
    expect(statusForError(504)).toBe("error");
    expect(statusForError(undefined)).toBe("error");
  });
});
