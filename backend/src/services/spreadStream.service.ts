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
import { ibkrService, StreamTickData } from "./ibkr.js";
import { marketDataLineRegistry } from "./marketDataLineRegistry.js";
import { SYMBOL_CONFIG } from "../utils/options.js";
import type {
  IronCondorChainStrike,
  SpreadStreamInitEvent,
  ChainUpdateEvent,
  RefocusedEvent,
} from "@assup/shared";

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
  private focusRange: { min: number; max: number } | undefined;
  private targetPutDelta: number | undefined;
  private targetCallDelta: number | undefined;
  private targetWingWidth: number;
  private unsubscribers: Array<() => void> = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private tickBuffer: Record<string, TickBufferEntry> = {};
  private underlyingPriceBuffer: number | null = null;
  private destroyed = false;

  // Scout → focus fields
  private phase: "scout" | "focused" = "focused";
  private scoutUnsubs: Array<() => void> = [];
  private scoutDeltas = new Map<string, number>(); // "strike:P" -> absolute delta
  private focusCheckTimer: ReturnType<typeof setInterval> | null = null;
  private scoutTimeout: ReturnType<typeof setTimeout> | null = null;

  // Stored from initialize() for use in transitionToFocus()
  private allFilteredStrikes: number[] = [];
  private storedOptionSymbol = "";
  private storedSelectedExpiration = "";
  private storedTradingClass = "";
  private storedMultiplier = 100;

  constructor(
    res: Response,
    symbol: string,
    expiration?: string,
    onlyStrikes?: number[],
    focusRange?: { min: number; max: number },
    targetPutDelta?: number,
    targetCallDelta?: number,
    targetWingWidth?: number,
  ) {
    this.res = res;
    this.sessionId = `spread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.symbol = symbol;
    this.expiration = expiration;
    this.onlyStrikes = onlyStrikes;
    this.focusRange = focusRange;
    this.targetPutDelta = targetPutDelta;
    this.targetCallDelta = targetCallDelta;
    this.targetWingWidth = targetWingWidth ?? 100;
  }

  async start(): Promise<void> {
    try {
      await this.initialize();
    } catch (err) {
      this.sendEvent("error", {
        message:
          err instanceof Error ? err.message : "Failed to initialize stream",
        recoverable: false,
      });
      this.destroy();
    }
  }

  private async initialize(): Promise<void> {
    const config = SYMBOL_CONFIG[this.symbol] ?? {
      tradingClass: this.symbol,
      multiplier: 100,
    };
    const optionSymbol = config.optionSymbol ?? this.symbol;
    const priceDivisor = config.priceDivisor ?? 1;

    // 1. Fetch underlying price
    const underlyingContract: Contract = {
      symbol: optionSymbol,
      secType: SecType.IND,
      exchange: "CBOE",
      currency: "USD",
    };
    const underlyingData = await ibkrService.getMarketData(underlyingContract);
    let underlyingPrice =
      underlyingData?.last ?? underlyingData?.bid ?? underlyingData?.ask ?? 0;
    if (underlyingPrice <= 0 && underlyingData?.close) {
      underlyingPrice = underlyingData.close;
    }
    underlyingPrice = underlyingPrice / priceDivisor;
    if (underlyingPrice <= 0) {
      throw new Error(`Could not get price for ${this.symbol}`);
    }

    // 2. Get security definitions via IBApiNext API
    const api = ibkrService.getApi();
    if (!api || !api.isConnected) {
      throw new Error("Not connected to TWS");
    }

    const contractDetails = await api.getContractDetails(underlyingContract);
    if (!contractDetails.length) {
      throw new Error(`No contract details for ${optionSymbol}`);
    }
    const conId = contractDetails[0].contract.conId!;

    const secDefs = await api.getSecDefOptParams(
      optionSymbol,
      "",
      SecType.IND,
      conId,
    );

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

    // 4. Filter strikes within ±15% of underlying price
    const strikes = [...allStrikes]
      .filter(
        (s) => s >= underlyingPrice * 0.85 && s <= underlyingPrice * 1.15,
      )
      .sort((a, b) => a - b);

    // 5. Resolve conIds for all option contracts in the selected expiration
    const tradingClass = activeDefs[0]?.tradingClass ?? config.tradingClass;
    const multiplier = Number(
      activeDefs[0]?.multiplier ?? config.multiplier,
    );

    // Acquire live market data BEFORE conId resolution — IBKR may reject
    // contract lookups when market data type is delayed for some instruments
    ibkrService.acquireLiveMarketData();

    const conIdMap = await this.resolveConIds(
      api,
      optionSymbol,
      selectedExpiration,
      strikes,
      tradingClass,
      multiplier,
    );

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

    // 7. Send init event
    this.sendEvent("init", {
      underlyingPrice,
      expirations,
      selectedExpiration,
      chain,
    } satisfies SpreadStreamInitEvent);

    // Store params for potential focus transition
    this.allFilteredStrikes = strikes;
    this.storedOptionSymbol = optionSymbol;
    this.storedSelectedExpiration = selectedExpiration;
    this.storedTradingClass = tradingClass;
    this.storedMultiplier = multiplier;

    // 8. Reserve market data lines and subscribe
    // When onlyStrikes is set (chain collapsed), only subscribe to those specific strikes
    const strikesToSubscribe = this.onlyStrikes
      ? strikes.filter(s => this.onlyStrikes!.includes(s))
      : strikes;

    const totalContracts = strikesToSubscribe.length * 2 + 1;
    const linesGranted = marketDataLineRegistry.reserve(
      this.sessionId,
      totalContracts,
    );

    // Subscribe to underlying
    const unsubUnderlying = ibkrService.subscribeMarketData(
      underlyingContract,
      (data: StreamTickData) => {
        const price =
          (data.last ?? data.bid ?? data.ask ?? 0) / priceDivisor;
        if (price > 0) {
          this.underlyingPriceBuffer = price;
        }
      },
    );
    this.unsubscribers.push(unsubUnderlying);

    // Determine which strikes to subscribe
    const maxStrikes = Math.floor((linesGranted - 1) / 2);
    const sorted = [...strikesToSubscribe].sort((a, b) => a - b);
    const subscribedStrikes = new Set<number>();

    // Should we use smart scout → focus?
    // Only when: target deltas provided, no explicit strike list or focus range,
    // and there are more strikes than we can subscribe to
    const shouldScout =
      !this.onlyStrikes &&
      !this.focusRange &&
      (this.targetPutDelta != null || this.targetCallDelta != null) &&
      sorted.length > maxStrikes;

    if (sorted.length <= maxStrikes) {
      for (const s of sorted) subscribedStrikes.add(s);
    } else if (this.focusRange) {
      // Dense subscription within focus range, sparse outside
      const focusStrikes = sorted.filter(
        (s) => s >= this.focusRange!.min && s <= this.focusRange!.max,
      );
      const outsideStrikes = sorted.filter(
        (s) => s < this.focusRange!.min || s > this.focusRange!.max,
      );

      // Add all focus strikes first
      for (const s of focusStrikes) subscribedStrikes.add(s);

      // Fill remaining budget with evenly sampled outside strikes
      const remaining = maxStrikes - subscribedStrikes.size;
      if (remaining > 0 && outsideStrikes.length > 0) {
        const step = Math.max(1, (outsideStrikes.length - 1) / (remaining - 1));
        for (let i = 0; i < remaining && i * step < outsideStrikes.length; i++) {
          subscribedStrikes.add(outsideStrikes[Math.round(i * step)]);
        }
      }
    } else {
      // Uniform sparse sampling across full range
      const step = (sorted.length - 1) / (maxStrikes - 1);
      for (let i = 0; i < maxStrikes; i++) {
        const idx = Math.round(i * step);
        subscribedStrikes.add(sorted[idx]);
      }
    }

    // Subscribe to option strikes
    const optionUnsubs = this.subscribeOptionStrikes(
      strikesToSubscribe.filter(s => subscribedStrikes.has(s)),
      optionSymbol,
      selectedExpiration,
      tradingClass,
      multiplier,
    );

    if (shouldScout) {
      // Scout phase: store unsubs separately, start focus monitor
      this.phase = "scout";
      this.scoutUnsubs = optionUnsubs;
      this.startFocusMonitor();
    } else {
      this.unsubscribers.push(...optionUnsubs);
    }

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

  /**
   * Subscribe to market data for a set of option strikes (both put and call).
   * Returns an array of unsubscribe functions.
   * Delta values are always tracked in scoutDeltas for the focus monitor.
   */
  private subscribeOptionStrikes(
    strikes: number[],
    optionSymbol: string,
    selectedExpiration: string,
    tradingClass: string,
    multiplier: number,
  ): Array<() => void> {
    const unsubs: Array<() => void> = [];

    for (const strike of strikes) {
      for (const right of [OptionType.Put, OptionType.Call] as const) {
        const optContract: Contract = {
          symbol: optionSymbol,
          secType: SecType.OPT,
          exchange: "SMART",
          currency: "USD",
          lastTradeDateOrContractMonth: selectedExpiration,
          strike,
          right,
          multiplier,
          tradingClass,
        };

        const rightKey = right === OptionType.Put ? "P" : "C";
        const bufferKey = `${strike}:${rightKey}`;

        const unsub = ibkrService.subscribeMarketData(
          optContract,
          (data: StreamTickData) => {
            const entry: TickBufferEntry = this.tickBuffer[bufferKey] ?? {
              strike,
              right: rightKey,
            };

            if (data.bid !== undefined && data.bid >= 0) entry.bid = data.bid;
            if (data.ask !== undefined && data.ask >= 0) entry.ask = data.ask;
            if (data.last !== undefined && data.last >= 0)
              entry.last = data.last;

            if (data.delta !== undefined) {
              const absDelta = Math.abs(data.delta);
              // Track for scout decision-making
              this.scoutDeltas.set(bufferKey, absDelta);
              // Always send to frontend (no suppression — auto-select fires
              // on sparse data immediately, then refines after focus transition)
              entry.delta = absDelta;
            }

            if (
              data.impliedVolatility !== undefined &&
              data.impliedVolatility > 0
            ) {
              entry.iv = data.impliedVolatility * 100;
            }
            if (entry.bid !== undefined && entry.ask !== undefined) {
              entry.mid =
                entry.bid > 0 && entry.ask > 0
                  ? (entry.bid + entry.ask) / 2
                  : 0;
            }

            this.tickBuffer[bufferKey] = entry;
          },
        );
        unsubs.push(unsub);
      }
    }

    return unsubs;
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
      const totalSubscribed = this.scoutUnsubs.length / 2; // put+call per strike
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
    if (this.phase !== "scout") return;
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
    const focusRanges: Array<{ min: number; max: number }> = [];

    if (this.targetPutDelta != null) {
      const region = this.findDeltaRegion("P", this.targetPutDelta);
      if (region) {
        // Put spread: sell leg near target delta, buy leg = sell - wingWidth
        focusRanges.push({
          min: region.low - this.targetWingWidth - 25,
          max: region.high + 25,
        });
      }
    }

    if (this.targetCallDelta != null) {
      const region = this.findDeltaRegion("C", this.targetCallDelta);
      if (region) {
        // Call spread: sell leg near target delta, buy leg = sell + wingWidth
        focusRanges.push({
          min: region.low - 25,
          max: region.high + this.targetWingWidth + 25,
        });
      }
    }

    // If no regions found, just start sending deltas from current subscriptions
    if (focusRanges.length === 0) {
      // Move scout unsubs to permanent unsubs
      this.unsubscribers.push(...this.scoutUnsubs);
      this.scoutUnsubs = [];
      return;
    }

    const merged = this.mergeRanges(focusRanges);

    // Unsubscribe scout option strikes
    for (const unsub of this.scoutUnsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.scoutUnsubs = [];

    // Clear stale scout data from the tick buffer
    this.tickBuffer = {};
    this.scoutDeltas.clear();

    // Release and re-reserve market data lines
    marketDataLineRegistry.release(this.sessionId);

    const focusStrikes = this.allFilteredStrikes.filter(s =>
      merged.some(r => s >= r.min && s <= r.max),
    );

    const needed = focusStrikes.length * 2 + 1; // +1 for underlying
    const granted = marketDataLineRegistry.reserve(this.sessionId, needed);

    if (granted <= 1) {
      // No budget for option strikes — just send the refocused event
      this.sendEvent("refocused", {
        focusRanges: merged,
      } satisfies RefocusedEvent);
      return;
    }

    const maxFocusStrikes = Math.floor((granted - 1) / 2);

    let strikesToSub: number[];
    if (focusStrikes.length <= maxFocusStrikes) {
      strikesToSub = focusStrikes;
    } else {
      // Budget exceeded — distribute proportionally across merged ranges
      // by sampling evenly within the combined focus set
      const step = (focusStrikes.length - 1) / (maxFocusStrikes - 1);
      strikesToSub = [];
      for (let i = 0; i < maxFocusStrikes; i++) {
        strikesToSub.push(focusStrikes[Math.round(i * step)]);
      }
    }

    // Subscribe to focus strikes
    const unsubs = this.subscribeOptionStrikes(
      strikesToSub,
      this.storedOptionSymbol,
      this.storedSelectedExpiration,
      this.storedTradingClass,
      this.storedMultiplier,
    );
    this.unsubscribers.push(...unsubs);

    // Notify frontend
    this.sendEvent("refocused", {
      focusRanges: merged,
    } satisfies RefocusedEvent);
  }

  /**
   * Find the strike range where the target delta (in percentage, e.g. 3.5)
   * is located, using scout delta data.
   *
   * Returns the two adjacent scout strikes that bracket the target, or
   * a margin around the closest strike if not bracketed.
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

    // Find adjacent pair that brackets the target delta.
    // For puts: |delta| increases with strike (OTM→ITM as strike rises toward spot).
    // For calls: delta decreases with strike (ITM→OTM as strike rises past spot).
    // We check both orderings since either side can bracket.
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];

      const lo = Math.min(a.delta, b.delta);
      const hi = Math.max(a.delta, b.delta);

      if (targetDelta >= lo && targetDelta <= hi) {
        return { low: a.strike, high: b.strike };
      }
    }

    // Target not bracketed — find closest and use generous margin
    const closest = entries.reduce((best, e) =>
      Math.abs(e.delta - targetDelta) < Math.abs(best.delta - targetDelta)
        ? e
        : best,
    );
    const margin = 75;
    return { low: closest.strike - margin, high: closest.strike + margin };
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
      const details = await api.getContractDetails({
        symbol,
        secType: SecType.OPT,
        exchange: "SMART",
        currency: "USD",
        lastTradeDateOrContractMonth: expiration,
        tradingClass,
        multiplier,
      });
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
    this.destroyed = true;

    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    for (const unsub of this.scoutUnsubs) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers = [];
    this.scoutUnsubs = [];

    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.focusCheckTimer) clearInterval(this.focusCheckTimer);
    if (this.scoutTimeout) clearTimeout(this.scoutTimeout);

    marketDataLineRegistry.release(this.sessionId);
    ibkrService.releaseLiveMarketData();
  }
}
