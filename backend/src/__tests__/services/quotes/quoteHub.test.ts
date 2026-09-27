import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Observable, type Subscriber } from "rxjs";
import type { Contract } from "@stoqey/ib";
import { QuoteHub, type MarketDataApi } from "../../../services/quotes/quoteHub.js";
import type { Quote, QuoteContract } from "../../../services/quotes/quoteTypes.js";

type Update = { all: ReadonlyMap<number, { value?: number }> };

interface FakeCall {
  contract: Contract;
  subscriber: Subscriber<Update>;
  unsubscribed: boolean;
}

/** IBApiNext stand-in: one cold Observable per getMarketData call. */
class FakeApi implements MarketDataApi {
  calls: FakeCall[] = [];

  getMarketData(contract: Contract): Observable<Update> {
    return new Observable<Update>((subscriber) => {
      const call: FakeCall = { contract, subscriber, unsubscribed: false };
      this.calls.push(call);
      return () => {
        call.unsubscribed = true;
      };
    });
  }

  /** Active (not unsubscribed, not errored) calls for a conId */
  active(conId: number): FakeCall[] {
    return this.calls.filter((c) => c.contract.conId === conId && !c.unsubscribed && !c.subscriber.closed);
  }

  emit(conId: number, ticks: Array<[number, number]>): void {
    const all = new Map(ticks.map(([k, v]) => [k, { value: v }]));
    for (const c of this.active(conId)) c.subscriber.next({ all });
  }

  fail(conId: number, code: number, message: string): void {
    for (const c of this.active(conId)) c.subscriber.error({ code, error: new Error(message) });
  }

  openLines(): number {
    return this.calls.filter((c) => !c.unsubscribed && !c.subscriber.closed).length;
  }
}

const opt = (conId: number): QuoteContract => ({ conId, secType: "OPT" });

function setup(opts: { maxLines?: number; headroom?: number; lingerMs?: number } = {}) {
  let api: FakeApi | null = new FakeApi();
  let connectionCb: ((connected: boolean) => void) | null = null;
  const hub = new QuoteHub({
    getApi: () => api,
    onConnectionChange: (cb) => {
      connectionCb = cb;
      return () => { connectionCb = null; };
    },
    maxLines: opts.maxLines ?? 100,
    headroom: opts.headroom ?? 10,
    lingerMs: opts.lingerMs ?? 30_000,
  });
  return {
    hub,
    get api() { return api!; },
    disconnect() { api = null; connectionCb?.(false); },
    reconnect(next: FakeApi) { api = next; connectionCb?.(true); },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QuoteHub.subscribe", () => {
  it("shares one TWS subscription between leases on the same contract", () => {
    const t = setup();
    const a = vi.fn();
    const b = vi.fn();
    t.hub.subscribe(opt(1), a);
    t.hub.subscribe({ conId: 1, secType: "OPT", symbol: "ZUL", strike: 25, exchange: "AMEX" }, b);

    expect(t.api.calls).toHaveLength(1);
    expect(t.api.calls[0].contract).toEqual({ conId: 1, exchange: "SMART" });

    t.api.emit(1, [[1, 2.6], [2, 2.7]]);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ bid: 2.6, ask: 2.7, status: "ok" }));
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ bid: 2.6, ask: 2.7, status: "ok" }));
  });

  it("throttles callbacks: leading update immediately, later ones coalesced into one trailing call", () => {
    const t = setup();
    const cb = vi.fn();
    t.hub.subscribe(opt(1), cb, { throttleMs: 250 });

    t.api.emit(1, [[1, 1.0]]);
    t.api.emit(1, [[1, 1.1]]);
    t.api.emit(1, [[1, 1.2]]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].bid).toBe(1.0);

    vi.advanceTimersByTime(250);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].bid).toBe(1.2);
  });

  it("stops calling back after release", () => {
    const t = setup();
    const cb = vi.fn();
    const lease = t.hub.subscribe(opt(1), cb, { throttleMs: 0 });
    lease.release();
    lease.release(); // idempotent
    t.api.emit(1, [[1, 1.0]]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("reports a TWS error on the lease and re-subscribes on the next request", () => {
    const t = setup();
    const cb = vi.fn();
    const lease = t.hub.subscribe(opt(1), cb, { throttleMs: 0 });
    t.api.fail(1, 200, "No security definition has been found for the request");

    expect(lease.quote()).toMatchObject({
      status: "no-contract",
      error: "No security definition has been found for the request",
    });
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ status: "no-contract" }));

    t.hub.subscribe(opt(1), vi.fn());
    expect(t.api.calls).toHaveLength(2);
  });
});

describe("QuoteHub.get", () => {
  it("resolves ok as soon as the requested fields arrive", async () => {
    const t = setup();
    const p = t.hub.get([opt(1)], { fields: ["bid", "ask"] });
    t.api.emit(1, [[1, 2.61], [2, 2.77]]);
    const quotes = await p;
    expect(quotes.get("conId:1")).toMatchObject({ status: "ok", bid: 2.61, ask: 2.77 });
  });

  it("resolves no-market when TWS reports -1 for a requested price", async () => {
    const t = setup();
    const p = t.hub.get([opt(1)], { fields: ["bid", "ask"] });
    t.api.emit(1, [[1, -1], [2, -1]]);
    expect((await p).get("conId:1")).toMatchObject({ status: "no-market", noMarket: ["bid", "ask"] });
  });

  it("times out with the values that did arrive", async () => {
    const t = setup();
    const p = t.hub.get([opt(1)], { fields: ["bid", "ask", "delta"], timeoutMs: 8000 });
    t.api.emit(1, [[1, 2.0], [2, 2.1]]);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await p).get("conId:1")).toMatchObject({ status: "timeout", bid: 2.0, ask: 2.1 });
  });

  it("maps subscription errors to statuses", async () => {
    const t = setup();
    const p = t.hub.get([opt(1), opt(2)], { fields: ["bid"] });
    t.api.fail(1, 200, "No security definition has been found for the request");
    t.api.fail(2, 10091, "Part of requested market data requires additional subscription");
    const quotes = await p;
    expect(quotes.get("conId:1")).toMatchObject({ status: "no-contract" });
    expect(quotes.get("conId:2")).toMatchObject({
      status: "not-subscribed",
      error: "Part of requested market data requires additional subscription",
    });
  });

  it("rejects when TWS is not connected", async () => {
    const t = setup();
    t.disconnect();
    await expect(t.hub.get([opt(1)], { fields: ["bid"] })).rejects.toThrow("Not connected to TWS");
  });

  it("returns promptly on abort, marking unfinished quotes as timeout", async () => {
    const t = setup();
    const controller = new AbortController();
    const p = t.hub.get([opt(1)], { fields: ["bid"], signal: controller.signal });
    controller.abort();
    expect((await p).get("conId:1")).toMatchObject({ status: "timeout", error: "Request aborted" });
  });

  it("serves fields already cached by a live lease without a new TWS request", async () => {
    const t = setup();
    t.hub.subscribe(opt(1), vi.fn());
    t.api.emit(1, [[1, 2.6], [2, 2.7]]);
    const quotes = await t.hub.get([opt(1)], { fields: ["bid", "ask"] });
    expect(quotes.get("conId:1")).toMatchObject({ status: "ok", bid: 2.6 });
    expect(t.api.calls).toHaveLength(1);
  });

  it("waits for the price virtual field (last, else close)", async () => {
    const t = setup();
    const p = t.hub.get([{ conId: 416904, secType: "IND", exchange: "CBOE" }], { fields: ["price"] });
    t.api.emit(416904, [[1, 0], [2, 0]]);
    t.api.emit(416904, [[4, 7633.69]]);
    expect((await p).get("conId:416904")).toMatchObject({ status: "ok", last: 7633.69 });
    expect(t.api.calls[0].contract).toEqual({ conId: 416904, exchange: "CBOE" });
  });

  it("reports progress as each contract settles", async () => {
    const t = setup();
    const onProgress = vi.fn();
    const p = t.hub.get([opt(1), opt(2)], { fields: ["bid"], onProgress });

    t.api.emit(1, [[1, 1]]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onProgress).toHaveBeenLastCalledWith(1, 2);

    t.api.emit(2, [[1, 2]]);
    await p;
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it("dedupes repeated contracts in one request", async () => {
    const t = setup();
    const p = t.hub.get([opt(1), opt(1)], { fields: ["bid"] });
    t.api.emit(1, [[1, 1]]);
    expect((await p).size).toBe(1);
    expect(t.api.calls).toHaveLength(1);
  });
});

describe("QuoteHub line budget", () => {
  it("lingers after the last release, then unsubscribes", () => {
    const t = setup({ lingerMs: 30_000 });
    t.hub.subscribe(opt(1), vi.fn()).release();
    expect(t.api.openLines()).toBe(1);

    vi.advanceTimersByTime(29_000);
    t.hub.subscribe(opt(1), vi.fn()).release(); // re-lease within the window: no new call
    expect(t.api.calls).toHaveLength(1);

    vi.advanceTimersByTime(30_000);
    expect(t.api.openLines()).toBe(0);
    expect(t.hub.stats()).toMatchObject({ activeLines: 0 });
  });

  it("evicts the longest-idle line when full", () => {
    const t = setup({ maxLines: 3, headroom: 0 });
    t.hub.subscribe(opt(1), vi.fn()).release();
    vi.advanceTimersByTime(10);
    t.hub.subscribe(opt(2), vi.fn()).release();
    vi.advanceTimersByTime(10);
    t.hub.subscribe(opt(3), vi.fn()).release();

    t.hub.subscribe(opt(4), vi.fn());
    expect(t.api.active(1)).toHaveLength(0);
    expect(t.api.active(2)).toHaveLength(1);
    expect(t.api.active(4)).toHaveLength(1);
    expect(t.api.openLines()).toBe(3);
  });

  it("reports no-lines when every line is leased", () => {
    const t = setup({ maxLines: 3, headroom: 0 });
    t.hub.subscribe(opt(1), vi.fn());
    t.hub.subscribe(opt(2), vi.fn());
    t.hub.subscribe(opt(3), vi.fn());

    const lease = t.hub.subscribe(opt(4), vi.fn());
    expect(lease.quote().status).toBe("no-lines");
    expect(lease.quote().error).toMatch(/3\/3 market data lines/);
    expect(t.api.calls).toHaveLength(3);
  });

  it("get() leaves headroom for interactive use and queues the rest", async () => {
    const t = setup({ maxLines: 12, headroom: 10 });
    const p = t.hub.get([1, 2, 3, 4, 5].map(opt), { fields: ["bid"] });

    expect(t.api.openLines()).toBe(2);
    t.api.emit(1, [[1, 1]]);
    t.api.emit(2, [[1, 1]]);
    await vi.advanceTimersByTimeAsync(0);
    // Finished contracts linger idle; the queue evicts them to continue
    expect(t.api.openLines()).toBe(2);
    t.api.emit(3, [[1, 1]]);
    t.api.emit(4, [[1, 1]]);
    await vi.advanceTimersByTimeAsync(0);
    t.api.emit(5, [[1, 1]]);

    const quotes = await p;
    expect([...quotes.values()].map((q: Quote) => q.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(t.api.calls).toHaveLength(5);
  });

  it("get() waits for a line rather than failing the batch outright", async () => {
    const t = setup({ maxLines: 12, headroom: 10 });
    const holder = t.hub.subscribe(opt(90), vi.fn());
    t.hub.subscribe(opt(91), vi.fn());

    const p = t.hub.get([opt(1)], { fields: ["bid"] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.api.active(1)).toHaveLength(0); // still waiting, not failed

    holder.release(); // frees a line the batch can evict
    await vi.advanceTimersByTimeAsync(1_000);
    t.api.emit(1, [[1, 2.5]]);

    const quotes = await p;
    expect(quotes.get("conId:1")?.status).toBe("ok");
  });

  it("get() reports no-lines once the wait for a line runs out", async () => {
    const t = setup({ maxLines: 12, headroom: 10 });
    t.hub.subscribe(opt(90), vi.fn());
    t.hub.subscribe(opt(91), vi.fn());

    let settled = false;
    const p = t.hub.get([opt(1)], { fields: ["bid"], lineWaitMs: 5_000 });
    void p.then(() => (settled = true));

    await vi.advanceTimersByTimeAsync(4_000);
    expect(settled).toBe(false); // still hoping for a line

    await vi.advanceTimersByTimeAsync(2_000);
    const quotes = await p;
    expect(quotes.get("conId:1")?.status).toBe("no-lines");
  });

  it("availableLines counts idle lines as free and applies headroom to batch", () => {
    const t = setup({ maxLines: 20, headroom: 10 });
    t.hub.subscribe(opt(1), vi.fn());
    t.hub.subscribe(opt(2), vi.fn()).release(); // idle
    expect(t.hub.availableLines("interactive")).toBe(19);
    expect(t.hub.availableLines("batch")).toBe(9);
    expect(t.hub.stats()).toEqual({ maxLines: 20, activeLines: 2, leasedLines: 1, idleLines: 1 });
  });

  it("drops idle lines on disconnect and resubscribes leased ones on reconnect", () => {
    const t = setup();
    const cb = vi.fn();
    const lease = t.hub.subscribe(opt(1), cb, { throttleMs: 0 });
    t.api.emit(1, [[1, 2.6]]);
    t.hub.subscribe(opt(2), vi.fn()).release();

    t.disconnect();
    expect(lease.quote()).toEqual({ key: "conId:1", status: "pending", updatedAt: null });
    expect(cb.mock.lastCall![0]).toEqual({ key: "conId:1", status: "pending", updatedAt: null });
    expect(t.hub.stats().activeLines).toBe(0);

    const next = new FakeApi();
    t.reconnect(next);
    expect(next.calls.map((c) => c.contract.conId)).toEqual([1]);
    next.emit(1, [[1, 2.7]]);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ bid: 2.7, status: "ok" }));
  });
});
