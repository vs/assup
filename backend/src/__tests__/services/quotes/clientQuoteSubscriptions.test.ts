import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Quote, QuoteContract } from "../../../services/quotes/quoteTypes.js";

const subscribe = vi.fn();
const sendToClient = vi.fn();

vi.mock("../../../services/quotes/index.js", () => ({
  quoteHub: { subscribe: (...args: unknown[]) => subscribe(...args) },
}));

vi.mock("../../../services/sse.js", () => ({
  sseService: { sendToClient: (...args: unknown[]) => sendToClient(...args) },
}));

const { clientQuoteSubscriptions } = await import("../../../services/quotes/clientQuoteSubscriptions.js");

interface FakeLease {
  conId: number;
  released: boolean;
  emit(q: Partial<Quote>): void;
}

let leases: FakeLease[] = [];

beforeEach(() => {
  // The service is a module singleton — clear leases left by earlier tests
  clientQuoteSubscriptions.release("client-1");
  clientQuoteSubscriptions.release("client-2");
  leases = [];
  subscribe.mockReset();
  sendToClient.mockReset();
  subscribe.mockImplementation((contract: QuoteContract, onQuote: (q: Quote) => void) => {
    const lease: FakeLease = {
      conId: contract.conId!,
      released: false,
      emit: (q) => onQuote({ key: `conId:${contract.conId}`, status: "ok", updatedAt: 1, ...q }),
    };
    leases.push(lease);
    return {
      key: `conId:${contract.conId}`,
      quote: () => ({ key: `conId:${contract.conId}`, status: "pending", updatedAt: null }) as Quote,
      release: () => { lease.released = true; },
    };
  });
});

const leaseFor = (conId: number) => leases.filter((l) => l.conId === conId);

describe("clientQuoteSubscriptions", () => {
  it("leases each conId and pushes its quotes to that SSE client", () => {
    clientQuoteSubscriptions.set("client-1", [1, 2]);

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[0][0]).toMatchObject({ conId: 1, secType: "OPT" });

    leaseFor(1)[0].emit({ bid: 2.6, ask: 2.7 });
    expect(sendToClient).toHaveBeenCalledWith("client-1", "quote", {
      conId: 1,
      quote: expect.objectContaining({ bid: 2.6, ask: 2.7 }),
    });
  });

  it("keeps overlapping leases and releases only the ones dropped", () => {
    clientQuoteSubscriptions.set("client-1", [1, 2]);
    clientQuoteSubscriptions.set("client-1", [2, 3]);

    expect(leaseFor(1)[0].released).toBe(true);
    expect(leaseFor(2)[0].released).toBe(false);
    expect(leaseFor(2)).toHaveLength(1); // not re-subscribed
    expect(leaseFor(3)[0].released).toBe(false);
  });

  it("keeps each client's leases separate", () => {
    clientQuoteSubscriptions.set("client-1", [1]);
    clientQuoteSubscriptions.set("client-2", [1]);
    clientQuoteSubscriptions.release("client-1");

    expect(leaseFor(1)[0].released).toBe(true);
    expect(leaseFor(1)[1].released).toBe(false);

    leaseFor(1)[1].emit({ bid: 1 });
    expect(sendToClient).toHaveBeenCalledWith("client-2", "quote", expect.anything());
    expect(sendToClient).not.toHaveBeenCalledWith("client-1", "quote", expect.anything());
  });

  it("releases everything when the client disconnects", () => {
    clientQuoteSubscriptions.set("client-1", [1, 2]);
    clientQuoteSubscriptions.release("client-1");

    expect(leases.every((l) => l.released)).toBe(true);
    clientQuoteSubscriptions.release("client-1"); // idempotent
  });

  it("ignores duplicate conIds in one request", () => {
    clientQuoteSubscriptions.set("client-1", [7, 7]);
    expect(leaseFor(7)).toHaveLength(1);
  });
});
