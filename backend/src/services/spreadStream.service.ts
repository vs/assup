/**
 * SpreadStreamSession manages the lifecycle of a streaming SSE session
 * for real-time options chain data. It handles IBKR subscriptions,
 * tick buffering, and SSE event emission.
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
  private unsubscribers: Array<() => void> = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private tickBuffer: Record<string, TickBufferEntry> = {};
  private underlyingPriceBuffer: number | null = null;
  private destroyed = false;

  constructor(res: Response, symbol: string, expiration?: string, onlyStrikes?: number[]) {
    this.res = res;
    this.sessionId = `spread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.symbol = symbol;
    this.expiration = expiration;
    this.onlyStrikes = onlyStrikes;
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

    // Prioritize ATM-nearest strikes for subscription
    const sortedByDistance = strikesToSubscribe
      .map((s) => ({ strike: s, distance: Math.abs(s - underlyingPrice) }))
      .sort((a, b) => a.distance - b.distance);

    const maxStrikes = Math.floor((linesGranted - 1) / 2);
    const subscribedStrikes = new Set(
      sortedByDistance.slice(0, maxStrikes).map((s) => s.strike),
    );

    for (const strike of strikesToSubscribe) {
      if (!subscribedStrikes.has(strike)) continue;

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
            if (data.delta !== undefined)
              entry.delta = Math.abs(data.delta);
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
        this.unsubscribers.push(unsub);
      }
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
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    this.unsubscribers = [];

    if (this.flushInterval) clearInterval(this.flushInterval);
    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);

    marketDataLineRegistry.release(this.sessionId);
    ibkrService.releaseLiveMarketData();
  }
}
