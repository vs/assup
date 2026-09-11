/**
 * Registry of order-level errors reported by TWS.
 *
 * TWS delivers order rejections asynchronously on the `error` observable with
 * `reqId` set to the order id. Rejected orders never appear in
 * `getAllOpenOrders()`, so polling order status alone cannot tell a rejection
 * apart from a slow acknowledgement — which is why orders used to report
 * success after silently failing.
 *
 * The registry is fed from the single global error subscriber in ibkr.ts, so an
 * error is captured even when it arrives before a caller begins waiting for
 * confirmation. Per-call subscriptions lose that race.
 */

export interface TwsOrderError {
  code: number;
  message: string;
  /** epoch ms */
  at: number;
}

/** Entries older than this are dropped. */
const ORDER_ERROR_TTL_MS = 60_000;

/** Pruning scans the whole map, so rate-limit it — TWS can emit errors in bursts. */
const PRUNE_INTERVAL_MS = 1_000;

/**
 * TWS codes that arrive with an order's reqId but do not reject the order.
 *   399   Order message / warning (e.g. quantity adjusted for the exchange)
 *   404   Shares not immediately available (informational)
 *   10147 Order to cancel is not found — it is already gone
 *   10148 Order to cancel could not be cancelled — already filled or cancelled
 */
const NON_FATAL_ORDER_CODES = new Set([399, 404, 10147, 10148]);

/**
 * Whether a TWS error code means the order did not make it.
 *
 * This is an allowlist of benign codes: an unrecognised code fails the order
 * rather than passing silently. Codes 2100-2200 are the TWS warning and system
 * message range.
 */
export function isFatalOrderError(code: number): boolean {
  if (code >= 2100 && code <= 2200) return false;
  return !NON_FATAL_ORDER_CODES.has(code);
}

export class OrderErrorRegistry {
  private errors = new Map<number, TwsOrderError[]>();
  private lastPruneAt = 0;

  constructor(private ttlMs = ORDER_ERROR_TTL_MS) {}

  record(orderId: number, code: number, message: string, now = Date.now()): void {
    if (now - this.lastPruneAt >= PRUNE_INTERVAL_MS) {
      this.prune(now);
      this.lastPruneAt = now;
    }
    const list = this.errors.get(orderId) ?? [];
    list.push({ code, message, at: now });
    this.errors.set(orderId, list);
  }

  /** All errors recorded for an order, oldest first. */
  get(orderId: number): TwsOrderError[] {
    return this.errors.get(orderId) ?? [];
  }

  /** The first error that means the order failed, or null. */
  firstFatal(orderId: number): TwsOrderError | null {
    return this.get(orderId).find((e) => isFatalOrderError(e.code)) ?? null;
  }

  /** Non-fatal messages — useful as context when reporting a timeout. */
  warnings(orderId: number): TwsOrderError[] {
    return this.get(orderId).filter((e) => !isFatalOrderError(e.code));
  }

  clear(orderId: number): void {
    this.errors.delete(orderId);
  }

  private prune(now: number): void {
    for (const [orderId, list] of this.errors) {
      const fresh = list.filter((e) => now - e.at < this.ttlMs);
      if (fresh.length === 0) this.errors.delete(orderId);
      else if (fresh.length !== list.length) this.errors.set(orderId, fresh);
    }
  }
}

/** Shared instance, fed by the global TWS error subscriber in ibkr.ts. */
export const orderErrorRegistry = new OrderErrorRegistry();
