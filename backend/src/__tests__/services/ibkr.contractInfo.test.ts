import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@stoqey/ib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stoqey/ib")>();
  const { BehaviorSubject, Subject } = await import("rxjs");

  class FakeIBApiNext {
    isConnected = true;
    connectionState = new BehaviorSubject(actual.ConnectionState.Disconnected);
    error = new Subject();
    connect() {
      return this;
    }
    disconnect() {}
    setMarketDataType() {}
    getAccountSummary() {
      return new Subject();
    }
    getPnL() {
      return new Subject();
    }
    // TWS sometimes never answers a contract details request: no data, no end marker, no error
    getContractDetails() {
      return new Promise(() => {});
    }
  }

  return { ...actual, IBApiNext: FakeIBApiNext };
});

describe("IBKRService.getContractInfo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
  });
  afterEach(() => vi.useRealTimers());

  it("fails instead of waiting forever when TWS never answers", async () => {
    const { ibkrService } = await import("../../services/ibkr.js");

    const result = ibkrService.getContractInfo("QZAC");
    const assertion = expect(result).rejects.toThrow(/getContractDetails for QZAC timed out/);

    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
