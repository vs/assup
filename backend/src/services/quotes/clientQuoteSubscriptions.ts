/**
 * Live quotes for frontend SSE clients.
 *
 * A client (one browser tab, identified by its /api/updates/stream clientId)
 * posts the full set of conIds it wants quoted; each gets a QuoteHub lease and
 * its updates are pushed as "quote" SSE events to that client only. Leases are
 * released when the set shrinks or the SSE connection closes, so a closed
 * dialog stops holding a market data line.
 */

import { quoteHub, type QuoteLease } from "./index.js";
import { sseService } from "../sse.js";

/** Matches the hub's default; the UI doesn't need faster than 4 updates/sec. */
const THROTTLE_MS = 250;

class ClientQuoteSubscriptions {
  private byClient = new Map<string, Map<number, QuoteLease>>();

  /** Replace this client's subscriptions with exactly `conIds`. */
  set(clientId: string, conIds: number[]): void {
    const wanted = new Set(conIds.filter((id) => Number.isInteger(id) && id > 0));
    const current = this.byClient.get(clientId) ?? new Map<number, QuoteLease>();

    for (const [conId, lease] of current) {
      if (!wanted.has(conId)) {
        lease.release();
        current.delete(conId);
      }
    }

    for (const conId of wanted) {
      if (current.has(conId)) continue;
      // conId + SMART is all TWS needs for options and stocks
      const lease = quoteHub.subscribe(
        { conId, secType: "OPT" },
        (quote) => sseService.sendToClient(clientId, "quote", { conId, quote }),
        { throttleMs: THROTTLE_MS },
      );
      current.set(conId, lease);
    }

    if (current.size > 0) this.byClient.set(clientId, current);
    else this.byClient.delete(clientId);
  }

  /** Release every lease held for a client (called when its SSE connection closes). */
  release(clientId: string): void {
    const current = this.byClient.get(clientId);
    if (!current) return;
    for (const lease of current.values()) lease.release();
    this.byClient.delete(clientId);
  }

  stats(): { clients: number; contracts: number } {
    let contracts = 0;
    for (const leases of this.byClient.values()) contracts += leases.size;
    return { clients: this.byClient.size, contracts };
  }
}

export const clientQuoteSubscriptions = new ClientQuoteSubscriptions();
