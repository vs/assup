import { describe, it, expect, beforeEach } from "vitest";
import {
  OrderErrorRegistry,
  isFatalOrderError,
} from "../../services/orderErrorRegistry.js";

describe("isFatalOrderError", () => {
  it("treats an order rejection as fatal", () => {
    expect(isFatalOrderError(201)).toBe(true);
  });

  it("treats a tick-size violation as fatal", () => {
    expect(isFatalOrderError(110)).toBe(true);
  });

  // Regression guard: 200 and 321 are suppressed from the log because the
  // scanner generates them in bulk, but they are real rejection causes.
  it("treats suppressed-from-log codes 200 and 321 as fatal", () => {
    expect(isFatalOrderError(200)).toBe(true);
    expect(isFatalOrderError(321)).toBe(true);
  });

  it("treats order warning messages as non-fatal", () => {
    expect(isFatalOrderError(399)).toBe(false);
    expect(isFatalOrderError(404)).toBe(false);
  });

  it("treats the 2100-2200 warning range as non-fatal", () => {
    expect(isFatalOrderError(2100)).toBe(false);
    expect(isFatalOrderError(2109)).toBe(false);
    expect(isFatalOrderError(2200)).toBe(false);
  });

  it("treats cancel-not-found codes as non-fatal", () => {
    expect(isFatalOrderError(10147)).toBe(false);
    expect(isFatalOrderError(10148)).toBe(false);
  });
});

describe("OrderErrorRegistry", () => {
  let registry: OrderErrorRegistry;

  beforeEach(() => {
    registry = new OrderErrorRegistry();
  });

  it("returns no errors for an unknown order", () => {
    expect(registry.get(999)).toEqual([]);
    expect(registry.firstFatal(999)).toBeNull();
  });

  it("records and returns an error for an order", () => {
    registry.record(1234, 201, "Order rejected");
    expect(registry.get(1234)).toHaveLength(1);
    expect(registry.get(1234)[0]).toMatchObject({ code: 201, message: "Order rejected" });
  });

  it("keeps errors for different orders separate", () => {
    registry.record(1, 201, "rejected");
    registry.record(2, 110, "bad price");
    expect(registry.firstFatal(1)?.code).toBe(201);
    expect(registry.firstFatal(2)?.code).toBe(110);
  });

  it("returns the first fatal error, skipping warnings", () => {
    registry.record(1234, 399, "Order Message: Warning");
    registry.record(1234, 201, "Order rejected");
    expect(registry.firstFatal(1234)?.code).toBe(201);
  });

  it("returns null when only warnings were recorded", () => {
    registry.record(1234, 2109, "outside regular trading hours");
    expect(registry.firstFatal(1234)).toBeNull();
    expect(registry.warnings(1234)).toHaveLength(1);
  });

  it("clears all errors for an order", () => {
    registry.record(1234, 201, "Order rejected");
    registry.clear(1234);
    expect(registry.get(1234)).toEqual([]);
  });

  it("prunes entries older than the TTL", () => {
    const ttlMs = 60_000;
    registry = new OrderErrorRegistry(ttlMs);
    registry.record(1234, 201, "old", 0);
    // A later write past the prune interval triggers pruning of stale entries.
    registry.record(5678, 201, "new", ttlMs + 1);
    expect(registry.get(1234)).toEqual([]);
    expect(registry.get(5678)).toHaveLength(1);
  });

  it("retains entries inside the TTL", () => {
    registry = new OrderErrorRegistry(60_000);
    registry.record(1234, 201, "recent", 0);
    registry.record(5678, 201, "newer", 30_000);
    expect(registry.get(1234)).toHaveLength(1);
  });
});
