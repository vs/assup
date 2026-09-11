import { describe, it, expect, beforeEach } from "vitest";
import type { OpenOrder } from "@stoqey/ib";
import { confirmOrder } from "../../services/orderConfirmation.js";
import { OrderErrorRegistry } from "../../services/orderErrorRegistry.js";
import { OrderRejectedError } from "../../errors/index.js";

/**
 * Deterministic clock: sleep advances virtual time, so the 5s window elapses
 * instantly instead of making the suite wait.
 */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

function openOrder(orderId: number, status: string): OpenOrder {
  return { orderId, orderStatus: { status } } as unknown as OpenOrder;
}

describe("confirmOrder", () => {
  let registry: OrderErrorRegistry;

  beforeEach(() => {
    registry = new OrderErrorRegistry();
  });

  it("resolves with the status once TWS confirms the order", async () => {
    const clock = fakeClock();
    const status = await confirmOrder(1234, {
      getOpenOrders: async () => [openOrder(1234, "Submitted")],
      registry,
      ...clock,
    });
    expect(status).toBe("Submitted");
  });

  it("resolves for a PreSubmitted order", async () => {
    const clock = fakeClock();
    const status = await confirmOrder(1234, {
      getOpenOrders: async () => [openOrder(1234, "PreSubmitted")],
      registry,
      ...clock,
    });
    expect(status).toBe("PreSubmitted");
  });

  // The race the old per-call subscription lost: TWS reports the rejection
  // before the caller ever starts waiting.
  it("reports a rejection recorded before the wait began", async () => {
    registry.record(1234, 201, "Order rejected - reason: insufficient margin");
    const clock = fakeClock();
    await expect(
      confirmOrder(1234, { getOpenOrders: async () => [], registry, ...clock }),
    ).rejects.toThrow(
      "TWS rejected order 1234 (error 201): Order rejected - reason: insufficient margin",
    );
  });

  it("reports a rejection that arrives while waiting", async () => {
    const clock = fakeClock();
    let polls = 0;
    const getOpenOrders = async () => {
      polls += 1;
      if (polls === 2) {
        registry.record(1234, 110, "The price does not conform to the minimum price variation");
      }
      return [];
    };
    await expect(
      confirmOrder(1234, { getOpenOrders, registry, ...clock }),
    ).rejects.toThrow("TWS rejected order 1234 (error 110)");
  });

  it("throws OrderRejectedError carrying the TWS code", async () => {
    registry.record(1234, 201, "Order rejected");
    const clock = fakeClock();
    const err = await confirmOrder(1234, {
      getOpenOrders: async () => [],
      registry,
      ...clock,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrderRejectedError);
    expect((err as OrderRejectedError).twsCode).toBe(201);
    expect((err as OrderRejectedError).statusCode).toBe(422);
  });

  it("does not fail an order on a benign warning", async () => {
    registry.record(1234, 399, "Order Message: Warning");
    const clock = fakeClock();
    const status = await confirmOrder(1234, {
      getOpenOrders: async () => [openOrder(1234, "Submitted")],
      registry,
      ...clock,
    });
    expect(status).toBe("Submitted");
  });

  it("fails when TWS reports the order cancelled", async () => {
    const clock = fakeClock();
    await expect(
      confirmOrder(1234, {
        getOpenOrders: async () => [openOrder(1234, "Cancelled")],
        registry,
        ...clock,
      }),
    ).rejects.toThrow("TWS cancelled order 1234");
  });

  it("fails when the window expires without confirmation", async () => {
    const clock = fakeClock();
    await expect(
      confirmOrder(1234, { getOpenOrders: async () => [], registry, ...clock }),
    ).rejects.toThrow("no confirmation within 5s");
  });

  it("includes benign TWS messages as context on timeout", async () => {
    registry.record(1234, 2109, "Order placed outside regular trading hours");
    const clock = fakeClock();
    await expect(
      confirmOrder(1234, { getOpenOrders: async () => [], registry, ...clock }),
    ).rejects.toThrow("2109: Order placed outside regular trading hours");
  });

  it("keeps waiting when status polling itself fails", async () => {
    const clock = fakeClock();
    let polls = 0;
    const getOpenOrders = async () => {
      polls += 1;
      if (polls === 1) throw new Error("getAllOpenOrders timed out");
      return [openOrder(1234, "Submitted")];
    };
    const status = await confirmOrder(1234, { getOpenOrders, registry, ...clock });
    expect(status).toBe("Submitted");
  });

  it("clears the order's registry entries once finished", async () => {
    registry.record(1234, 201, "Order rejected");
    const clock = fakeClock();
    await confirmOrder(1234, { getOpenOrders: async () => [], registry, ...clock }).catch(
      () => undefined,
    );
    expect(registry.get(1234)).toEqual([]);
  });
});
