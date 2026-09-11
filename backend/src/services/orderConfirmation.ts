/**
 * Confirming that TWS actually accepted an order.
 *
 * Order status alone is not enough: a rejected order never shows up in
 * getAllOpenOrders(), so a poll-only loop cannot distinguish "rejected" from
 * "not acknowledged yet" and used to report success for both. This combines
 * status polling with the order-error registry, and treats an unconfirmed order
 * as a failure rather than assuming it went through.
 */

import type { OpenOrder } from "@stoqey/ib";
import { OrderRejectedError } from "../errors/index.js";
import { orderErrorRegistry, OrderErrorRegistry } from "./orderErrorRegistry.js";

export const ORDER_CONFIRM_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 500;

const CONFIRMED_STATUSES = ["PreSubmitted", "Submitted", "Filled"];
const FAILED_STATUSES = ["Cancelled", "Inactive"];

export interface ConfirmOrderDeps {
  getOpenOrders: () => Promise<OpenOrder[]>;
  registry?: OrderErrorRegistry;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Benign TWS messages, rendered as trailing context on a failure. */
function contextSuffix(registry: OrderErrorRegistry, orderId: number): string {
  const warnings = registry.warnings(orderId);
  if (warnings.length === 0) return "";
  const detail = warnings.map((w) => `${w.code}: ${w.message}`).join("; ");
  return ` (TWS messages — ${detail})`;
}

/**
 * Wait for TWS to confirm an order.
 *
 * @returns the TWS status string once the order is confirmed
 * @throws OrderRejectedError if TWS rejected the order, reported it as
 *   cancelled or inactive, or gave no confirmation within the window
 */
export async function confirmOrder(
  orderId: number,
  deps: ConfirmOrderDeps,
): Promise<string> {
  const {
    getOpenOrders,
    registry = orderErrorRegistry,
    timeoutMs = ORDER_CONFIRM_TIMEOUT_MS,
    pollIntervalMs = POLL_INTERVAL_MS,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = deps;

  const rejection = (): OrderRejectedError | null => {
    const fatal = registry.firstFatal(orderId);
    if (!fatal) return null;
    return new OrderRejectedError(
      `TWS rejected order ${orderId} (error ${fatal.code}): ${fatal.message}`,
      fatal.code,
    );
  };

  const startedAt = now();

  try {
    for (;;) {
      // Checked before the first sleep: TWS often reports a rejection before
      // placeNewOrder() even resolves, so sleeping first can burn the window.
      const early = rejection();
      if (early) throw early;

      let status: string | undefined;
      try {
        const orders = await getOpenOrders();
        const found = orders.find((o) => o.orderId === orderId);
        status = found?.orderStatus?.status || found?.orderState?.status;
      } catch (err) {
        // Status polling failed (e.g. a transient TWS timeout). The registry is
        // the authoritative rejection signal, so keep waiting instead of
        // turning a polling hiccup into a failed order.
        console.debug(`Order ${orderId}: status poll failed: ${err}`);
      }

      // An error may have landed while getOpenOrders() was in flight.
      const duringPoll = rejection();
      if (duringPoll) throw duringPoll;

      if (status && FAILED_STATUSES.includes(status)) {
        throw new OrderRejectedError(
          `TWS ${status.toLowerCase()} order ${orderId}${contextSuffix(registry, orderId)}`,
        );
      }
      if (status && CONFIRMED_STATUSES.includes(status)) {
        return status;
      }

      if (now() - startedAt >= timeoutMs) break;
      await sleep(pollIntervalMs);
    }

    throw new OrderRejectedError(
      `Order ${orderId} was sent but TWS gave no confirmation within ` +
        `${Math.round(timeoutMs / 1000)}s — verify in TWS before retrying.` +
        contextSuffix(registry, orderId),
    );
  } finally {
    // Errors for this id are consumed; leaving them would poison a later
    // modify or cancel of the same order.
    registry.clear(orderId);
  }
}
