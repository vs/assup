import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConnectionState } from "@stoqey/ib";
import type { BehaviorSubject, Subject } from "rxjs";

interface FakeApi {
  isConnected: boolean;
  connectionState: BehaviorSubject<ConnectionState>;
  accountSummary: Subject<{ all: Map<string, unknown> }>;
  pnlRequests: Subject<{ dailyPnL?: number; unrealizedPnL?: number; realizedPnL?: number }>[];
}

const fake = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("@stoqey/ib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoqey/ib")>();
  const { BehaviorSubject, Subject } = await import("rxjs");

  class FakeIBApiNext {
    isConnected = false;
    connectionState = new BehaviorSubject(actual.ConnectionState.Disconnected);
    error = new Subject();
    accountSummary = new Subject();
    pnlRequests: unknown[] = [];

    constructor() {
      fake.instances.push(this);
    }
    connect() {
      return this;
    }
    disconnect() {}
    setMarketDataType() {}
    getAccountSummary() {
      return this.accountSummary;
    }
    getPnL() {
      const request = new Subject();
      this.pnlRequests.push(request);
      return request;
    }
  }

  return { ...actual, IBApiNext: FakeIBApiNext };
});

describe("IBKRService daily PnL subscription", () => {
  let api: FakeApi;
  let service: typeof import("../../services/ibkr.js").ibkrService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    fake.instances.length = 0;

    ({ ibkrService: service } = await import("../../services/ibkr.js"));
    api = fake.instances[0] as FakeApi;

    // Connect, report the account, and let the PnL subscription start
    api.isConnected = true;
    api.connectionState.next(ConnectionState.Connected);
    api.accountSummary.next({ all: new Map([["U0000000", {}]]) });
    await vi.advanceTimersByTimeAsync(1000);
  });

  afterEach(async () => {
    await service.disconnect();
    vi.useRealTimers();
  });

  it("re-subscribes after TWS rejects the PnL request", async () => {
    expect(api.pnlRequests).toHaveLength(1);

    api.pnlRequests[0].error(new Error("Duplicate ticker id"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.pnlRequests).toHaveLength(2);
    api.pnlRequests[1].next({ dailyPnL: 12.5, unrealizedPnL: 3, realizedPnL: 4 });
    expect(service.getDailyPnL()).toEqual({ dailyPnL: 12.5, unrealizedPnL: 3, realizedPnL: 4 });
  });

  it("backs off while the PnL request keeps failing", async () => {
    api.pnlRequests[0].error(new Error("Duplicate ticker id"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.pnlRequests).toHaveLength(2);

    api.pnlRequests[1].error(new Error("Duplicate ticker id"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.pnlRequests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.pnlRequests).toHaveLength(3);
  });

  it("does not re-subscribe once TWS has disconnected", async () => {
    api.pnlRequests[0].error(new Error("Duplicate ticker id"));
    api.isConnected = false;
    api.connectionState.next(ConnectionState.Disconnected);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(api.pnlRequests).toHaveLength(1);
  });
});
