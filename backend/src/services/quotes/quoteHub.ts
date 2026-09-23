/**
 * QuoteHub — the single owner of TWS market data subscriptions.
 *
 * Why it exists (measured against TWS on 2026-09-17): option snapshots take
 * ~11.7s while streaming delivers bid/ask in ~0.14s and model greeks in <1s.
 * TWS allows a limited number of simultaneous market data lines, and
 * @stoqey/ib only shares a line between byte-identical requests. So every
 * consumer goes through this hub, which:
 *
 * - keeps one streaming subscription per canonical contract (see quoteKey),
 *   shared by all leases on it, with the latest ticks cached;
 * - lingers released subscriptions for a while so re-opening a dialog is instant;
 * - enforces the line budget, evicting idle lines first and keeping headroom
 *   free of batch work for interactive use;
 * - reports why a quote is missing (QuoteStatus) instead of returning 0/null;
 * - resubscribes leased contracts after a TWS reconnect.
 */

import type { Contract } from "@stoqey/ib";
import type { Observable, Subscription } from "rxjs";
import { applyTicks, hasField, quoteKey, statusForError, subscribeContract } from "./quoteKey.js";
import type { Quote, QuoteContract, QuoteField, QuoteStatus } from "./quoteTypes.js";

export interface MarketDataApi {
  getMarketData(
    contract: Contract,
    genericTickList: string,
    snapshot: boolean,
    regulatorySnapshot: boolean,
  ): Observable<{ all: ReadonlyMap<number, { value?: number }> }>;
}

export interface QuoteHubDeps {
  getApi(): MarketDataApi | null;
  onConnectionChange(cb: (connected: boolean) => void): () => void;
  /** Simultaneous market data lines the TWS account allows */
  maxLines?: number;
  /** How long a released subscription stays open for reuse */
  lingerMs?: number;
  /** Lines batch requests (get) must leave free for interactive streams */
  headroom?: number;
}

export interface QuoteLease {
  key: string;
  /** Snapshot of the latest quote */
  quote(): Quote;
  release(): void;
}

export type LinePriority = "batch" | "interactive";

const ERROR_STATUSES: ReadonlySet<QuoteStatus> = new Set([
  "no-contract",
  "not-subscribed",
  "no-lines",
  "error",
]);

interface Lease {
  onQuote?: (q: Quote) => void;
  throttleMs: number;
  lastEmit: number;
  timer: ReturnType<typeof setTimeout> | null;
  released: boolean;
}

interface Entry {
  key: string;
  contract: QuoteContract;
  quote: Quote;
  sub: Subscription | null;
  leases: Set<Lease>;
  idleSince: number | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  /** get() waiters, re-checked on every tick or error */
  waiters: Set<() => void>;
}

function copyQuote(q: Quote): Quote {
  return { ...q, noMarket: q.noMarket ? [...q.noMarket] : undefined };
}

export class QuoteHub {
  private entries = new Map<string, Entry>();
  private readonly maxLines: number;
  private readonly lingerMs: number;
  private readonly headroom: number;

  constructor(private deps: QuoteHubDeps) {
    this.maxLines = deps.maxLines ?? 100;
    this.lingerMs = deps.lingerMs ?? 30_000;
    this.headroom = deps.headroom ?? 10;
    deps.onConnectionChange((connected) => (connected ? this.handleConnected() : this.handleDisconnected()));
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Long-lived lease for streaming consumers. `onQuote` receives the latest
   * quote on every change, throttled per lease (leading + trailing edge).
   * Check `lease.quote().status` for "no-lines" or TWS errors.
   */
  subscribe(
    contract: QuoteContract,
    onQuote: (q: Quote) => void,
    opts: { throttleMs?: number } = {},
  ): QuoteLease {
    const entry = this.entryFor(contract);
    const lease = this.addLease(entry, onQuote, opts.throttleMs ?? 250);
    if (!entry.sub && this.deps.getApi()) this.openLine(entry, "interactive");
    if (entry.quote.updatedAt !== null || ERROR_STATUSES.has(entry.quote.status)) {
      this.notifyLease(lease, entry);
    }
    return {
      key: entry.key,
      quote: () => copyQuote(entry.quote),
      release: () => this.releaseLease(entry, lease),
    };
  }

  /**
   * Quote contracts once: waits until every requested field is present for
   * each contract (or TWS says there's no market / errors / the per-contract
   * timeout passes), then releases. Never throws for per-contract failures —
   * read each Quote's status. Look results up with quoteKey(contract).
   */
  async get(
    contracts: QuoteContract[],
    opts: { fields: QuoteField[]; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<Map<string, Quote>> {
    if (!this.deps.getApi()) throw new Error("Not connected to TWS");
    const { fields, timeoutMs = 8000, signal } = opts;

    const results = new Map<string, Quote>();
    const unique = new Map<string, QuoteContract>();
    for (const c of contracts) unique.set(quoteKey(c), c);
    // Pre-fill in input order so callers iterating the map see a stable order
    for (const key of unique.keys()) results.set(key, { key, status: "pending", updatedAt: null });

    const queue = [...unique.values()];
    let inFlight = 0;

    await new Promise<void>((resolveAll) => {
      let settled = false;
      const finishAll = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolveAll();
      };
      const abortHandlers = new Set<() => void>();
      const onAbort = () => {
        for (const contract of queue.splice(0)) {
          const key = quoteKey(contract);
          results.set(key, { key, status: "timeout", updatedAt: null, error: "Request aborted" });
        }
        for (const h of [...abortHandlers]) h();
        if (inFlight === 0) finishAll();
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort);

      const pump = () => {
        while (queue.length > 0) {
          const contract = queue[0];
          const entry = this.entryFor(contract);

          const immediate = this.requestStatus(entry, fields);
          if (entry.sub && immediate !== null) {
            queue.shift();
            results.set(entry.key, { ...copyQuote(entry.quote), status: immediate });
            this.dropIfUnused(entry);
            continue;
          }
          if (!entry.sub && !this.openLine(entry, "batch", inFlight > 0)) {
            if (inFlight > 0) {
              this.dropIfUnused(entry);
              return; // wait for an in-flight contract to free a line
            }
            queue.shift();
            results.set(entry.key, copyQuote(entry.quote));
            this.dropIfUnused(entry);
            continue;
          }

          queue.shift();
          inFlight++;
          startWaiting(entry);
        }
        if (inFlight === 0) finishAll();
      };

      const startWaiting = (entry: Entry) => {
        const lease = this.addLease(entry, undefined, 0);
        let done = false;
        const finish = (status: QuoteStatus, error?: string) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          entry.waiters.delete(check);
          abortHandlers.delete(abort);
          const q = copyQuote(entry.quote);
          q.status = status;
          if (error) q.error = error;
          results.set(entry.key, q);
          this.releaseLease(entry, lease);
          inFlight--;
          if (!settled) pump();
        };
        const check = () => {
          const status = this.requestStatus(entry, fields);
          if (status !== null) finish(status);
        };
        const abort = () => finish("timeout", "Request aborted");
        const timer = setTimeout(() => finish("timeout"), timeoutMs);
        entry.waiters.add(check);
        abortHandlers.add(abort);
        check();
      };

      pump();
    });

    return results;
  }

  /** Lines a new consumer of this priority could open (idle lines count as free). */
  availableLines(priority: LinePriority): number {
    const limit = priority === "batch" ? this.maxLines - this.headroom : this.maxLines;
    return Math.max(0, limit - this.stats().leasedLines);
  }

  stats(): { maxLines: number; activeLines: number; leasedLines: number; idleLines: number } {
    let activeLines = 0;
    let leasedLines = 0;
    for (const e of this.entries.values()) {
      if (!e.sub) continue;
      activeLines++;
      if (e.leases.size > 0) leasedLines++;
    }
    return { maxLines: this.maxLines, activeLines, leasedLines, idleLines: activeLines - leasedLines };
  }

  // -------------------------------------------------------------------------
  // Entries and leases
  // -------------------------------------------------------------------------

  private entryFor(contract: QuoteContract): Entry {
    const key = quoteKey(contract);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        contract,
        quote: { key, status: "pending", updatedAt: null },
        sub: null,
        leases: new Set(),
        idleSince: null,
        lingerTimer: null,
        waiters: new Set(),
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private addLease(entry: Entry, onQuote: ((q: Quote) => void) | undefined, throttleMs: number): Lease {
    const lease: Lease = { onQuote, throttleMs, lastEmit: 0, timer: null, released: false };
    entry.leases.add(lease);
    entry.idleSince = null;
    if (entry.lingerTimer) {
      clearTimeout(entry.lingerTimer);
      entry.lingerTimer = null;
    }
    return lease;
  }

  private releaseLease(entry: Entry, lease: Lease): void {
    if (lease.released) return;
    lease.released = true;
    if (lease.timer) clearTimeout(lease.timer);
    entry.leases.delete(lease);
    if (entry.leases.size > 0) return;

    if (!entry.sub) {
      this.dropIfUnused(entry);
      return;
    }
    entry.idleSince = Date.now();
    entry.lingerTimer = setTimeout(() => this.closeEntry(entry), this.lingerMs);
  }

  /** Remove an entry nobody leases and that holds no line. */
  private dropIfUnused(entry: Entry): void {
    if (entry.leases.size === 0 && !entry.sub && entry.waiters.size === 0) {
      this.entries.delete(entry.key);
    }
  }

  private closeEntry(entry: Entry): void {
    if (entry.lingerTimer) clearTimeout(entry.lingerTimer);
    entry.lingerTimer = null;
    this.unsubscribe(entry);
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  }

  private unsubscribe(entry: Entry): void {
    const sub = entry.sub;
    entry.sub = null;
    try {
      sub?.unsubscribe();
    } catch {
      // The API that owned this subscription may already be gone (reconnect)
    }
  }

  // -------------------------------------------------------------------------
  // Lines
  // -------------------------------------------------------------------------

  /**
   * Open the TWS subscription for an entry within the priority's line limit,
   * evicting the longest-idle line if needed. On failure sets status
   * "no-lines" (unless `quiet`, used when a batch will retry) and returns false.
   */
  private openLine(entry: Entry, priority: LinePriority, quiet = false): boolean {
    const api = this.deps.getApi();
    if (!api) return false;

    const limit = priority === "batch" ? this.maxLines - this.headroom : this.maxLines;
    while (this.stats().activeLines >= limit) {
      if (!this.evictIdle()) {
        if (!quiet) {
          const { activeLines, leasedLines } = this.stats();
          entry.quote.status = "no-lines";
          entry.quote.error =
            `No market data line available for ${entry.key}: ${leasedLines}/${this.maxLines} market data lines ` +
            `are in use (${activeLines} open, ${priority} limit ${limit}). Close a live options chain and try again.`;
          console.warn(`[QuoteHub] ${entry.quote.error}`);
        }
        return false;
      }
    }

    // Errors from a previous attempt no longer apply
    if (ERROR_STATUSES.has(entry.quote.status)) {
      entry.quote.status = "pending";
      delete entry.quote.error;
    }

    const contract = subscribeContract(entry.contract);
    entry.sub = api.getMarketData(contract, "", false, false).subscribe({
      next: (update) => {
        applyTicks(entry.quote, update.all, Date.now());
        entry.quote.status = entry.quote.noMarket?.length ? "no-market" : "ok";
        this.notify(entry);
      },
      error: (err: { code?: number; error?: { message?: string }; message?: string }) => {
        entry.sub = null;
        entry.quote.status = statusForError(err?.code);
        entry.quote.error = err?.error?.message ?? err?.message ?? String(err);
        this.notify(entry);
        if (entry.leases.size === 0) {
          if (entry.lingerTimer) clearTimeout(entry.lingerTimer);
          entry.lingerTimer = null;
          this.dropIfUnused(entry);
        }
      },
    });
    return true;
  }

  private evictIdle(): boolean {
    let oldest: Entry | null = null;
    for (const e of this.entries.values()) {
      if (!e.sub || e.leases.size > 0 || e.idleSince === null) continue;
      if (!oldest || e.idleSince < oldest.idleSince!) oldest = e;
    }
    if (!oldest) return false;
    this.closeEntry(oldest);
    return true;
  }

  // -------------------------------------------------------------------------
  // Readiness and notification
  // -------------------------------------------------------------------------

  /** Terminal status for a get() on this entry, or null to keep waiting. */
  private requestStatus(entry: Entry, fields: QuoteField[]): QuoteStatus | null {
    const q = entry.quote;
    if (ERROR_STATUSES.has(q.status)) return q.status;
    const noMarket = q.noMarket ?? [];
    if (fields.some((f) => (f === "bid" || f === "ask") && noMarket.includes(f))) return "no-market";
    if (fields.every((f) => hasField(q, f))) return "ok";
    return null;
  }

  private notify(entry: Entry): void {
    for (const check of [...entry.waiters]) check();
    for (const lease of entry.leases) this.notifyLease(lease, entry);
  }

  private notifyLease(lease: Lease, entry: Entry): void {
    if (!lease.onQuote || lease.released) return;
    const emit = () => {
      lease.timer = null;
      if (lease.released) return;
      lease.lastEmit = Date.now();
      lease.onQuote!(copyQuote(entry.quote));
    };
    if (lease.throttleMs <= 0) {
      emit();
      return;
    }
    if (lease.timer) return; // trailing emit already scheduled; it reads the latest quote
    const wait = lease.lastEmit + lease.throttleMs - Date.now();
    if (wait <= 0) emit();
    else lease.timer = setTimeout(emit, wait);
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  private handleDisconnected(): void {
    for (const entry of [...this.entries.values()]) {
      this.unsubscribe(entry);
      if (entry.leases.size === 0) {
        if (entry.lingerTimer) clearTimeout(entry.lingerTimer);
        entry.lingerTimer = null;
        if (entry.waiters.size === 0) this.entries.delete(entry.key);
        continue;
      }
      entry.quote.status = "pending";
      this.notify(entry);
    }
  }

  private handleConnected(): void {
    for (const entry of this.entries.values()) {
      if (entry.leases.size > 0 && !entry.sub) this.openLine(entry, "interactive");
    }
  }
}
