/**
 * SpreadStreamSession manages the lifecycle of a streaming SSE session
 * for real-time options chain data. It handles IBKR subscriptions,
 * tick buffering, and SSE event emission.
 *
 * When target deltas are provided, uses a two-phase subscription strategy:
 * 1. Scout phase: sparse uniform sampling to discover where target deltas are.
 *    All data (including deltas) flows to the frontend so the UI is responsive
 *    immediately. The backend monitors arriving deltas internally.
 * 2. Focus phase: once enough delta data arrives, the backend identifies the
 *    strike regions matching the target deltas, unsubscribes scouts, and
 *    subscribes densely around those regions (+ wing offsets). A "refocused"
 *    event is sent so the frontend can re-run auto-select with accurate data.
 */

import { Response } from "express";
import { Contract, SecType, OptionType } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { quoteHub, quoteKey, quotePrice, summarizeStatuses, type Quote, type QuoteContract } from "./quotes/index.js";
import { SYMBOL_CONFIG, getSymbolContractType } from "../utils/options.js";
import { resolveUnderlyingConId } from "./underlyingConId.service.js";
import { withTimeout } from "../utils/withTimeout.js";
import {
  planStrikeSubscriptions,
  type FocusRange,
  type OptionSide,
  type SubscriptionGroup,
} from "./spreadSubscriptionPlan.js";
import type {
  IronCondorChainStrike,
  SpreadStreamInitEvent,
  ChainUpdateEvent,
  RefocusedEvent,
} from "@assup/shared";

/** Deadlines for IBKR requests that TWS may never answer (see withTimeout). */
const SECDEF_TIMEOUT_MS = 15_000;
/** Shorter than the others: the chain renders without conIds, so this deadline
 *  is the longest the builder stays blank when TWS won't answer. A healthy TWS
 *  returns a full strike ladder in a few seconds. */
const OPTION_CONID_TIMEOUT_MS = 8_000;

const SIDE_TO_RIGHT: Record<OptionSide, typeof OptionType.Put | typeof OptionType.Call> = {
  P: OptionType.Put,
  C: OptionType.Call,
};

function toPlanSides(
  rights: Array<typeof OptionType.Put | typeof OptionType.Call>,
): OptionSide[] {
  return rights.map((r) => (r === OptionType.Put ? "P" : "C"));
}

/** Drop the side tags — the client only needs the strike bounds. */
function toBounds(ranges: FocusRange[]): Array<{ min: number; max: number }> {
  return ranges.map((r) => ({ min: r.min, max: r.max }));
}

interface TickBufferEntry {
  strike: number;
  right: "P" | "C";
  bid?: number;
  ask?: number;
  mid?: number;
  delta?: number;
  iv?: number;
  last?: number;
}

export class SpreadStreamSession {
  private res: Response;
  private sessionId: string;
  private symbol: string;
  private expiration: string | undefined;
  private onlyStrikes: number[] | undefined;
  private focusRanges: FocusRange[];
  private targetPutDelta: number | undefined;
  private targetCallDelta: number | undefined;
  private targetWingWidth: number;
  private mode: string | undefined;
  private strikeRangePct: number | undefined;
  private unsubscribers: Array<() => void> = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private tickBuffer: Record<string, TickBufferEntry> = {};
  private underlyingPriceBuffer: number | null = null;
  private destroyed = false;

  // Scout → focus fields
  private phase: "scout" | "focused" = "focused";
  private scoutDeltas = new Map<string, number>(); // "strike:P" -> absolute delta
  private focusCheckTimer: ReturnType<typeof setInterval> | null = null;
  private scoutTimeout: ReturnType<typeof setTimeout> | null = null;

  // Per-strike subscription tracking (key: "strike:P"/"strike:C" → unsub fn)
  private strikeUnsubs = new Map<string, () => void>();
  // Current focus ranges for drift comparison
  private currentFocusRanges: Array<{ min: number; max: number }> = [];
  // Drift monitoring timer
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  // Budget tracking
  private linesGranted = 0;

  // Stored from initialize() for use in transitionToFocus()
  private allFilteredStrikes: number[] = [];
  private storedSelectedExpiration = "";
  private storedTradingClass = "";
  private storedMultiplier = 100;
  private storedSides: Array<typeof OptionType.Put | typeof OptionType.Call> = [OptionType.Put, OptionType.Call];

  constructor(
    res: Response,
    symbol: string,
    expiration?: string,
    onlyStrikes?: number[],
    focusRanges?: FocusRange[],
    targetPutDelta?: number,
    targetCallDelta?: number,
    targetWingWidth?: number,
    mode?: string,
    strikeRangePct?: number,
  ) {
    this.res = res;
    this.sessionId = `spread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.symbol = symbol;
    this.expiration = expiration;
    this.onlyStrikes = onlyStrikes;
    this.focusRanges = focusRanges ?? [];
    this.targetPutDelta = targetPutDelta;
    this.targetCallDelta = targetCallDelta;
    this.targetWingWidth = targetWingWidth ?? 100;
    this.mode = mode;
    this.strikeRangePct = strikeRangePct;
  }

  async start(): Promise<void> {
    try {
      await this.initialize();
    } catch (err) {
      console.error(`[SpreadStream:${this.sessionId}] initialize() threw:`, err);
      this.sendEvent("error", {
        message:
          err instanceof Error ? err.message : "Failed to initialize stream",
        recoverable: false,
      });
      this.destroy();
    }
  }

  private async initialize(): Promise<void> {
    const t0 = Date.now();
    console.log(`[SpreadStream:${this.sessionId}] init start symbol=${this.symbol} mode=${this.mode ?? "iron-condor"}`);

    const config = SYMBOL_CONFIG[this.symbol] ?? {
      tradingClass: this.symbol,
      multiplier: 100,
    };
    // Price-only redirect: e.g. XSP fetches its underlying price from SPX/10
    // because SPX has reliable index data. The chain query and option contracts
    // still use this.symbol — XSPW is a child of XSP in IBKR, not SPX, so
    // querying getSecDefOptParams via SPX returns SPX strikes (~5000), and
    // filtering against XSP's ~580 underlying yields an empty chain.
    const priceSymbol = config.priceSymbol ?? this.symbol;
    const priceDivisor = config.priceDivisor ?? 1;

    // Price contract — may redirect to a different symbol (XSP → SPX)
    const { secType: priceSecType, exchange: priceExchange } =
      getSymbolContractType(priceSymbol);
    const priceContract: Contract = {
      symbol: priceSymbol,
      secType: priceSecType,
      exchange: priceExchange,
      currency: "USD",
    };

    // Chain queries always use this.symbol, never the price redirect
    const { secType: underlyingSecType } = getSymbolContractType(this.symbol);

    // 1. Fetch underlying price
    const priceQuote = (
      await quoteHub.get([priceContract as QuoteContract], { fields: ["price"], timeoutMs: 5000 })
    ).get(quoteKey(priceContract as QuoteContract))!;
    if (this.destroyed) return;
    const rawPrice = quotePrice(priceQuote);
    if (rawPrice === undefined) {
      throw new Error(`Could not get price for ${this.symbol} from ${priceSymbol}: ${summarizeStatuses([priceQuote])}`);
    }
    const underlyingPrice = rawPrice / priceDivisor;

    // 2. Get security definitions via IBApiNext API
    const api = ibkrService.getApi();
    if (!api || !api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const conId = await resolveUnderlyingConId(api, this.symbol);
    if (this.destroyed) return;

    const secDefs = await withTimeout(
      api.getSecDefOptParams(this.symbol, "", underlyingSecType, conId),
      `getSecDefOptParams(${this.symbol})`,
      SECDEF_TIMEOUT_MS,
    );
    if (this.destroyed) return;

    // Union expirations and strikes from ALL matching definitions
    const preferredDefs = secDefs.filter(
      (d: any) => d.tradingClass === config.tradingClass,
    );
    const activeDefs = preferredDefs.length > 0 ? preferredDefs : secDefs;
    if (activeDefs.length === 0) {
      throw new Error(`No security definitions for ${this.symbol}`);
    }

    const allExpirations = new Set<string>();
    const allStrikes = new Set<number>();
    for (const def of activeDefs) {
      if (def.expirations) {
        for (const exp of def.expirations) allExpirations.add(exp);
      }
      if (def.strikes) {
        for (const strike of def.strikes) allStrikes.add(strike);
      }
    }

    // 3. Select expiration
    const expirations = [...allExpirations].sort();
    let selectedExpiration: string;
    if (this.expiration && allExpirations.has(this.expiration)) {
      selectedExpiration = this.expiration;
    } else {
      const today = new Date();
      selectedExpiration =
        expirations.find((exp) => {
          const expDate = new Date(
            `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}`,
          );
          const dte = Math.ceil(
            (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );
          return dte >= 1;
        }) ?? expirations[expirations.length - 1];
    }

    // 4. Filter strikes around underlying price.
    // Index options (SPX/XSP/RUT) have dense chains — use ±15%.
    // Equity options need a wider range (±30%) since strikes are sparser
    // and call spreads require visibility above the current price.
    // The client can override with a custom range percentage.
    const isIndex = !!SYMBOL_CONFIG[this.symbol];
    const defaultRangePct = isIndex ? 0.15 : 0.30;
    const rangePct = this.strikeRangePct != null ? this.strikeRangePct / 100 : defaultRangePct;
    const strikes = [...allStrikes]
      .filter(
        (s) => s >= underlyingPrice * (1 - rangePct) && s <= underlyingPrice * (1 + rangePct),
      )
      .sort((a, b) => a - b);

    // 5. Resolve conIds for all option contracts in the selected expiration
    const tradingClass = activeDefs[0]?.tradingClass ?? config.tradingClass;
    const multiplier = Number(
      activeDefs[0]?.multiplier ?? config.multiplier,
    );

    const conIdMap = await this.resolveConIds(
      api,
      this.symbol,
      selectedExpiration,
      strikes,
      tradingClass,
      multiplier,
    );
    if (this.destroyed) return;

    // 6. Build initial chain — include entries for ALL strikes even without conIds.
    // Strikes without conIds still get streaming data, just can't be used for orders.
    const chain: IronCondorChainStrike[] = strikes.map((strike) => {
      const putConId = conIdMap.get(`${strike}:P`);
      const callConId = conIdMap.get(`${strike}:C`);
      return {
        strike,
        put: {
          conId: putConId ?? 0,
          bid: 0, ask: 0, mid: 0, last: 0, delta: 0, iv: 0,
        },
        call: {
          conId: callConId ?? 0,
          bid: 0, ask: 0, mid: 0, last: 0, delta: 0, iv: 0,
        },
      };
    });

    // 7. Send init event (scouting flag set after subscription decision below)
    // Defer until we know if scouting is needed
    const initChain = chain;

    // Only subscribe to the side(s) needed for the spread mode.
    // put-spread → puts only, call-spread → calls only, iron-condor → both.
    // This doubles strike coverage for single-side spreads.
    const subscribeSides: Array<typeof OptionType.Put | typeof OptionType.Call> =
      this.mode === "put-spread" ? [OptionType.Put]
        : this.mode === "call-spread" ? [OptionType.Call]
        : [OptionType.Put, OptionType.Call];

    // Store params for potential focus transition
    this.allFilteredStrikes = strikes;
    this.storedSelectedExpiration = selectedExpiration;
    this.storedTradingClass = tradingClass;
    this.storedMultiplier = multiplier;
    this.storedSides = subscribeSides;

    // 8. Reserve market data lines and subscribe
    // When onlyStrikes is set (chain collapsed), only subscribe to those specific strikes
    const strikesToSubscribe = this.onlyStrikes
      ? strikes.filter(s => this.onlyStrikes!.includes(s))
      : strikes;

    // Size the subscription to the lines the QuoteHub can give interactive
    // streams right now (contracts other sessions already stream cost nothing).
    const totalContracts = strikesToSubscribe.length * subscribeSides.length + 1;
    this.linesGranted = Math.min(totalContracts, quoteHub.availableLines("interactive"));
    const linesGranted = this.linesGranted;
    console.log(`[SpreadStream:${this.sessionId}] lines granted ${linesGranted}/${totalContracts} (${JSON.stringify(quoteHub.stats())})`);

    // Subscribe to underlying price stream — uses the price contract,
    // which may be a substitute (e.g. SPX for XSP). Quotes are scaled
    // back to this.symbol via priceDivisor before exposure to clients.
    const underlyingLease = quoteHub.subscribe(
      priceContract as QuoteContract,
      (q: Quote) => {
        const price = quotePrice(q);
        if (price !== undefined) {
          this.underlyingPriceBuffer = price / priceDivisor;
        }
      },
      { throttleMs: 150 },
    );
    this.unsubscribers.push(() => underlyingLease.release());

    // Determine which strikes to subscribe
    const maxStrikes = Math.floor((linesGranted - 1) / subscribeSides.length);
    const sorted = [...strikesToSubscribe].sort((a, b) => a - b);

    // Should we use smart scout → focus?
    // Only when: target deltas provided, no explicit strike list or focus
    // ranges, and there are more strikes than we can subscribe to
    const shouldScout =
      !this.onlyStrikes &&
      this.focusRanges.length === 0 &&
      (this.targetPutDelta != null || this.targetCallDelta != null) &&
      sorted.length > maxStrikes;

    // Share the granted lines out between the focus ranges (one per wing) and
    // the rest of the ladder — see spreadSubscriptionPlan for why the budget
    // can't simply be spent in strike order.
    this.subscribePlan(
      planStrikeSubscriptions({
        strikes: sorted,
        sides: toPlanSides(subscribeSides),
        budget: linesGranted - 1,
        focusRanges: this.focusRanges,
      }),
      selectedExpiration,
      tradingClass,
      multiplier,
    );

    if (shouldScout) {
      this.phase = "scout";
      this.startFocusMonitor();
    }

    // Send init event with scouting flag
    this.sendEvent("init", {
      underlyingPrice,
      expirations,
      selectedExpiration,
      chain: initChain,
      scouting: shouldScout,
    } satisfies SpreadStreamInitEvent);
    console.log(`[SpreadStream:${this.sessionId}] init sent in ${Date.now() - t0}ms — strikes=${initChain.length} exp=${selectedExpiration} scout=${shouldScout}`);

    // 10. Start flush interval (150ms)
    this.flushInterval = setInterval(() => this.flushTickBuffer(), 150);

    // 11. Start keepalive (30s)
    this.keepaliveInterval = setInterval(() => {
      if (!this.destroyed) {
        this.res.write(": keepalive\n\n");
      }
    }, 30000);

    // 12. Subscribe to IBKR connection status for error reporting
    const unsubIbkr = ibkrService.subscribe((status) => {
      if (!status.connected) {
        this.sendEvent("error", {
          message: "IBKR disconnected",
          recoverable: true,
        });
      }
    });
    this.unsubscribers.push(unsubIbkr);
  }

  /** Subscribe every group of a plan, each on the sides that group asked for. */
  private subscribePlan(
    plan: SubscriptionGroup[],
    selectedExpiration: string,
    tradingClass: string,
    multiplier: number,
  ): void {
    for (const group of plan) {
      this.subscribeOptionStrikes(
        group.strikes,
        this.symbol,
        selectedExpiration,
        tradingClass,
        multiplier,
        group.sides.map((side) => SIDE_TO_RIGHT[side]),
      );
    }
  }

  /** Move the live subscriptions onto `plan`, releasing whatever it drops. */
  private applyPlan(plan: SubscriptionGroup[]): void {
    const wanted = new Set<string>();
    for (const group of plan) {
      for (const strike of group.strikes) {
        for (const side of group.sides) wanted.add(`${strike}:${side}`);
      }
    }
    for (const [key, unsub] of this.strikeUnsubs) {
      if (wanted.has(key)) continue;
      try { unsub(); } catch { /* ignore */ }
      this.strikeUnsubs.delete(key);
      this.scoutDeltas.delete(key);
    }
    this.subscribePlan(
      plan,
      this.storedSelectedExpiration,
      this.storedTradingClass,
      this.storedMultiplier,
    );
  }

  /** Contracts the focus ranges would stream if lines were free. */
  private focusDemand(ranges: FocusRange[], sides: OptionSide[]): number {
    const claimed = new Set<string>();
    for (const range of ranges) {
      for (const side of range.sides ?? sides) {
        for (const strike of this.allFilteredStrikes) {
          if (strike < range.min || strike > range.max) continue;
          claimed.add(`${strike}:${side}`);
        }
      }
    }
    return claimed.size;
  }

  /**
   * Subscribe to market data for a set of option strikes.
   * Only subscribes to the sides specified (puts, calls, or both).
   * Adds subscriptions directly to this.strikeUnsubs Map.
   * Skips strikes already subscribed.
   * Delta values are always tracked in scoutDeltas for focus/drift monitoring.
   */
  private subscribeOptionStrikes(
    strikes: number[],
    underlyingSymbol: string,
    selectedExpiration: string,
    tradingClass: string,
    multiplier: number,
    sides: Array<typeof OptionType.Put | typeof OptionType.Call> = [OptionType.Put, OptionType.Call],
  ): void {
    for (const strike of strikes) {
      for (const right of sides) {
        const rightKey = right === OptionType.Put ? "P" : "C";
        const bufferKey = `${strike}:${rightKey}`;

        // Skip if already subscribed
        if (this.strikeUnsubs.has(bufferKey)) continue;

        const optContract: Contract = {
          symbol: underlyingSymbol,
          secType: SecType.OPT,
          exchange: "SMART",
          currency: "USD",
          lastTradeDateOrContractMonth: selectedExpiration,
          strike,
          right,
          multiplier,
          tradingClass,
        };

        const lease = quoteHub.subscribe(
          optContract as QuoteContract,
          (data: Quote) => {
            const entry: TickBufferEntry = this.tickBuffer[bufferKey] ?? {
              strike,
              right: rightKey,
            };

            if (data.bid !== undefined) entry.bid = data.bid;
            if (data.ask !== undefined) entry.ask = data.ask;
            if (data.last !== undefined) entry.last = data.last;

            if (data.delta !== undefined) {
              const absDelta = Math.abs(data.delta);
              // Track for scout/focus/drift decision-making
              this.scoutDeltas.set(bufferKey, absDelta);
              entry.delta = absDelta;
            }

            if (data.iv !== undefined && data.iv > 0) {
              entry.iv = data.iv * 100;
            }
            if (entry.bid !== undefined && entry.ask !== undefined) {
              entry.mid =
                entry.bid > 0 && entry.ask > 0
                  ? (entry.bid + entry.ask) / 2
                  : 0;
            }

            this.tickBuffer[bufferKey] = entry;
          },
          { throttleMs: 150 },
        );
        if (lease.quote().status === "no-lines") {
          lease.release();
          continue;
        }
        this.strikeUnsubs.set(bufferKey, () => lease.release());
      }
    }
  }

  /**
   * Start monitoring scout delta data. Once enough deltas arrive to
   * identify the target regions, transition to focused subscription.
   */
  private startFocusMonitor(): void {
    this.focusCheckTimer = setInterval(() => {
      if (this.phase !== "scout" || this.destroyed) {
        if (this.focusCheckTimer) {
          clearInterval(this.focusCheckTimer);
          this.focusCheckTimer = null;
        }
        return;
      }

      // Require at least 30% of subscribed strikes (min 3) to have deltas
      const totalSubscribed = this.strikeUnsubs.size / this.storedSides.length;
      const minRequired = Math.max(3, Math.floor(totalSubscribed * 0.3));

      let putReady = this.targetPutDelta == null;
      let callReady = this.targetCallDelta == null;

      if (!putReady) {
        let count = 0;
        for (const [key, delta] of this.scoutDeltas) {
          if (key.endsWith(":P") && delta > 0) count++;
        }
        putReady = count >= minRequired;
      }

      if (!callReady) {
        let count = 0;
        for (const [key, delta] of this.scoutDeltas) {
          if (key.endsWith(":C") && delta > 0) count++;
        }
        callReady = count >= minRequired;
      }

      if (putReady && callReady) {
        this.transitionToFocus();
      }
    }, 300);

    // Fallback: if deltas don't arrive in 10s, transition with whatever we have
    this.scoutTimeout = setTimeout(() => {
      if (this.phase === "scout" && !this.destroyed) {
        this.transitionToFocus();
      }
    }, 10000);
  }

  /**
   * Transition from scout to focused subscription.
   * Identifies delta regions, unsubscribes scouts, subscribes densely
   * around target areas + wing offsets.
   */
  private transitionToFocus(): void {
    if (this.phase !== "scout" || this.destroyed) return;
    this.phase = "focused";

    if (this.focusCheckTimer) {
      clearInterval(this.focusCheckTimer);
      this.focusCheckTimer = null;
    }
    if (this.scoutTimeout) {
      clearTimeout(this.scoutTimeout);
      this.scoutTimeout = null;
    }

    // Compute focus regions from scout delta data
    const focusRanges = this.computeFocusRanges();

    // If no regions found, keep current subscriptions
    if (focusRanges.length === 0) {
      // Start drift monitor to detect when deltas become available
      this.startDriftMonitor();
      return;
    }

    const merged = this.mergeRanges(toBounds(focusRanges));

    // Unsubscribe ALL scout option strikes
    for (const [, unsub] of this.strikeUnsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.strikeUnsubs.clear();

    // Clear stale scout data from the tick buffer
    this.tickBuffer = {};
    this.scoutDeltas.clear();

    // Re-size to the lines now available (the scout leases just released count as free)
    const planSides = toPlanSides(this.storedSides);
    const needed = this.focusDemand(focusRanges, planSides) + 1; // +1 for underlying
    this.linesGranted = Math.min(needed, quoteHub.availableLines("interactive"));

    if (this.linesGranted <= 1) {
      this.sendEvent("refocused", {
        focusRanges: merged,
      } satisfies RefocusedEvent);
      return;
    }

    // Each wing gets its own share of the budget — spending it in strike order
    // would leave the call wing without a single line.
    this.subscribePlan(
      planStrikeSubscriptions({
        strikes: this.allFilteredStrikes,
        sides: planSides,
        budget: this.linesGranted - 1,
        focusRanges,
      }),
      this.storedSelectedExpiration,
      this.storedTradingClass,
      this.storedMultiplier,
    );

    this.currentFocusRanges = merged;

    // Notify frontend — auto-select can now fire with accurate data
    this.sendEvent("refocused", {
      focusRanges: merged,
    } satisfies RefocusedEvent);

    // Start monitoring for delta drift
    this.startDriftMonitor();
  }

  /**
   * Compute focus ranges from current delta data.
   * Uses interpolation for narrow, accurate ranges.
   */
  private computeFocusRanges(): FocusRange[] {
    const focusRanges: FocusRange[] = [];
    // Padding around the core range for delta drift tolerance
    const padding = 25;

    if (this.targetPutDelta != null) {
      const region = this.findDeltaRegion("P", this.targetPutDelta);
      if (region) {
        // Put spread: sell leg near target delta, buy leg = sell - wingWidth
        focusRanges.push({
          min: region.low - this.targetWingWidth - padding,
          max: region.high + padding,
          sides: ["P"],
        });
      }
    }

    if (this.targetCallDelta != null) {
      const region = this.findDeltaRegion("C", this.targetCallDelta);
      if (region) {
        // Call spread: sell leg near target delta, buy leg = sell + wingWidth
        focusRanges.push({
          min: region.low - padding,
          max: region.high + this.targetWingWidth + padding,
          sides: ["C"],
        });
      }
    }

    return focusRanges;
  }

  /**
   * Start monitoring for delta drift after focus transition.
   * Every 5 seconds, checks if the target delta has shifted enough
   * to warrant adjusting subscriptions.
   */
  private startDriftMonitor(): void {
    if (this.driftTimer) return;
    this.driftTimer = setInterval(() => {
      if (this.destroyed || this.phase !== "focused") {
        if (this.driftTimer) {
          clearInterval(this.driftTimer);
          this.driftTimer = null;
        }
        return;
      }
      this.adjustFocusIfNeeded();
    }, 5000);
  }

  /**
   * Check if target deltas have drifted and adjust subscriptions.
   * Called periodically by the drift monitor.
   */
  private adjustFocusIfNeeded(): void {
    // Need enough delta data to make decisions (at least 3 per relevant side)
    const minDataPoints = 3;
    if (this.targetPutDelta != null) {
      let count = 0;
      for (const [key] of this.scoutDeltas) {
        if (key.endsWith(":P")) count++;
      }
      if (count < minDataPoints) return;
    }
    if (this.targetCallDelta != null) {
      let count = 0;
      for (const [key] of this.scoutDeltas) {
        if (key.endsWith(":C")) count++;
      }
      if (count < minDataPoints) return;
    }

    const newRanges = this.computeFocusRanges();
    if (newRanges.length === 0) return;

    const merged = this.mergeRanges(toBounds(newRanges));

    // Check if ranges have changed significantly (any boundary moved > 10 points)
    if (this.currentFocusRanges.length === merged.length) {
      let changed = false;
      for (let i = 0; i < merged.length; i++) {
        if (
          Math.abs(merged[i].min - this.currentFocusRanges[i].min) > 10 ||
          Math.abs(merged[i].max - this.currentFocusRanges[i].max) > 10
        ) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
    }

    // Ranges shifted — re-plan within the same budget and move the
    // subscriptions onto the new plan.
    this.applyPlan(
      planStrikeSubscriptions({
        strikes: this.allFilteredStrikes,
        sides: toPlanSides(this.storedSides),
        budget: this.linesGranted - 1,
        focusRanges: newRanges,
      }),
    );

    this.currentFocusRanges = merged;

    // Notify frontend to re-run auto-select with updated data
    this.sendEvent("refocused", {
      focusRanges: merged,
    } satisfies RefocusedEvent);
  }

  /**
   * Find the narrow strike range where the target delta (in percentage, e.g. 3.5)
   * is located, using delta data. Interpolates between bracketing strikes for
   * a precise, narrow region instead of returning the wide bracket gap.
   *
   * Returns a narrow range centered on the interpolated target strike.
   */
  private findDeltaRegion(
    right: "P" | "C",
    targetDelta: number,
  ): { low: number; high: number } | null {
    const entries: Array<{ strike: number; delta: number }> = [];
    for (const [key, delta] of this.scoutDeltas) {
      if (key.endsWith(`:${right}`) && delta > 0) {
        const strike = parseFloat(key.split(":")[0]);
        entries.push({ strike, delta: delta * 100 }); // convert to percentage
      }
    }

    if (entries.length < 2) return null;
    entries.sort((a, b) => a.strike - b.strike);

    // Narrow margin around the interpolated strike (enough for ~5 strikes on SPX)
    const narrowMargin = 25;

    // Find adjacent pair that brackets the target delta.
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];

      const lo = Math.min(a.delta, b.delta);
      const hi = Math.max(a.delta, b.delta);

      if (targetDelta >= lo && targetDelta <= hi) {
        // Interpolate to find approximate target strike
        const deltaRange = b.delta - a.delta;
        const frac = deltaRange !== 0
          ? (targetDelta - a.delta) / deltaRange
          : 0.5;
        const interpolated = a.strike + frac * (b.strike - a.strike);
        return {
          low: interpolated - narrowMargin,
          high: interpolated + narrowMargin,
        };
      }
    }

    // Target not bracketed — find closest and use small margin
    const closest = entries.reduce((best, e) =>
      Math.abs(e.delta - targetDelta) < Math.abs(best.delta - targetDelta)
        ? e
        : best,
    );
    return {
      low: closest.strike - narrowMargin,
      high: closest.strike + narrowMargin,
    };
  }

  /**
   * Merge overlapping or adjacent ranges into non-overlapping ranges.
   */
  private mergeRanges(
    ranges: Array<{ min: number; max: number }>,
  ): Array<{ min: number; max: number }> {
    if (ranges.length <= 1) return [...ranges];
    const sorted = [...ranges].sort((a, b) => a.min - b.min);
    const merged: Array<{ min: number; max: number }> = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      if (sorted[i].min <= last.max) {
        last.max = Math.max(last.max, sorted[i].max);
      } else {
        merged.push({ ...sorted[i] });
      }
    }
    return merged;
  }

  private async resolveConIds(
    api: NonNullable<ReturnType<typeof ibkrService.getApi>>,
    symbol: string,
    expiration: string,
    strikes: number[],
    tradingClass: string,
    multiplier: number,
  ): Promise<Map<string, number>> {
    const conIdMap = new Map<string, number>();
    try {
      // TWS answers this for equity options but silently drops it for index
      // options, so the deadline is what keeps a chain from never rendering —
      // the caller builds strikes without conIds when the map comes back short.
      const details = await withTimeout(
        api.getContractDetails({
          symbol,
          secType: SecType.OPT,
          exchange: "SMART",
          currency: "USD",
          lastTradeDateOrContractMonth: expiration,
          tradingClass,
          multiplier,
        }),
        `getContractDetails(${symbol} ${expiration} options)`,
        OPTION_CONID_TIMEOUT_MS,
      );
      for (const d of details) {
        const c = d.contract;
        if (c.conId && c.strike != null && c.right) {
          const rightKey = c.right === OptionType.Put ? "P" : "C";
          if (strikes.includes(c.strike)) {
            conIdMap.set(`${c.strike}:${rightKey}`, c.conId);
          }
        }
      }
    } catch (err) {
      console.error("Failed to resolve conIds:", err);
    }
    return conIdMap;
  }

  private flushTickBuffer(): void {
    const keys = Object.keys(this.tickBuffer);
    if (keys.length === 0 && this.underlyingPriceBuffer === null) return;

    const event: ChainUpdateEvent = {
      updates: keys.map((key) => this.tickBuffer[key]),
    };
    if (this.underlyingPriceBuffer !== null) {
      event.underlyingPrice = this.underlyingPriceBuffer;
      this.underlyingPriceBuffer = null;
    }

    this.sendEvent("chain-update", event);
    this.tickBuffer = {};
  }

  private sendEvent(type: string, data: unknown): void {
    if (this.destroyed) return;
    try {
      const message = JSON.stringify({
        type,
        data,
        timestamp: new Date().toISOString(),
      });
      this.res.write(`data: ${message}\n\n`);
    } catch {
      // Client likely disconnected
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    console.log(`[SpreadStream:${this.sessionId}] destroy() called`);
    this.destroyed = true;

    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    for (const [, unsub] of this.strikeUnsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.strikeUnsubs.clear();

    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.focusCheckTimer) clearInterval(this.focusCheckTimer);
    if (this.scoutTimeout) clearTimeout(this.scoutTimeout);
    if (this.driftTimer) clearInterval(this.driftTimer);

  }
}
