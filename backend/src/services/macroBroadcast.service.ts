/**
 * Periodic macro data broadcaster.
 * Subscribes once to streaming VIX and SPX market data, caches the latest
 * tick values, and broadcasts every 5 seconds via SSE so the frontend
 * fear/greed gauge stays live. Streaming avoids the per-poll snapshot races
 * that left the LAST tick missing for indices.
 */

import { Contract, SecType } from "@stoqey/ib";
import { ibkrService, type StreamTickData } from "./ibkr.js";
import { sseService } from "./sse.js";
import { prisma } from "../db/index.js";
import { getGexAnalysis } from "./gex.service.js";
import { marketDataLineRegistry } from "./marketDataLineRegistry.js";
import type { MacroGexLevels } from "@assup/shared";

const VIX_CONTRACT: Contract = { symbol: "VIX", secType: SecType.IND, exchange: "CBOE", currency: "USD" };
const SPX_CONTRACT: Contract = { symbol: "SPX", secType: SecType.IND, exchange: "CBOE", currency: "USD" };

const BROADCAST_INTERVAL_MS = 5_000;
const STREAM_SESSION_ID = "macro-broadcast";

interface TickCache {
  last?: number;
  close?: number;
}

class MacroBroadcastService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: Record<string, unknown> | null = null;
  private lastBroadcast: Record<string, unknown> | null = null;
  private gexLevels: MacroGexLevels | null = null;
  private gexTimer: ReturnType<typeof setInterval> | null = null;
  private vixCache: TickCache = {};
  private spxCache: TickCache = {};
  private streamUnsubscribers: Array<() => void> = [];
  private connectionUnsubscribe: (() => void) | null = null;

  start() {
    if (this.timer) return;
    console.log("[MacroBroadcast] Starting live macro broadcasts every 5s");
    this.timer = setInterval(() => this.tick(), BROADCAST_INTERVAL_MS);

    // Manage stream subscriptions based on IBKR connection lifecycle.
    // The listener fires immediately with current status, so streams come up
    // right away if IBKR is already connected.
    this.connectionUnsubscribe = ibkrService.subscribe((status) => {
      if (status.connected) {
        this.subscribeStreams();
      } else {
        this.unsubscribeStreams();
      }
    });

    this.refreshGexLevels();
    this.gexTimer = setInterval(() => this.refreshGexLevels(), 10 * 60 * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.gexTimer) {
      clearInterval(this.gexTimer);
      this.gexTimer = null;
    }
    if (this.connectionUnsubscribe) {
      this.connectionUnsubscribe();
      this.connectionUnsubscribe = null;
    }
    this.unsubscribeStreams();
  }

  private subscribeStreams() {
    if (this.streamUnsubscribers.length > 0) return;

    const granted = marketDataLineRegistry.reserve(STREAM_SESSION_ID, 2);
    if (granted < 2) {
      console.warn("[MacroBroadcast] Not enough market data lines to subscribe VIX/SPX");
      marketDataLineRegistry.release(STREAM_SESSION_ID);
      return;
    }

    try {
      const unsubVix = ibkrService.subscribeMarketData(
        VIX_CONTRACT,
        (data) => this.applyTick(this.vixCache, data),
        (err) => console.error("[MacroBroadcast] VIX stream error:", err.message),
      );
      const unsubSpx = ibkrService.subscribeMarketData(
        SPX_CONTRACT,
        (data) => this.applyTick(this.spxCache, data),
        (err) => console.error("[MacroBroadcast] SPX stream error:", err.message),
      );
      this.streamUnsubscribers.push(unsubVix, unsubSpx);
      console.log("[MacroBroadcast] Subscribed to VIX/SPX streams");
    } catch (err) {
      console.error("[MacroBroadcast] Failed to subscribe streams:", err);
      marketDataLineRegistry.release(STREAM_SESSION_ID);
    }
  }

  private unsubscribeStreams() {
    for (const unsub of this.streamUnsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.streamUnsubscribers = [];
    marketDataLineRegistry.release(STREAM_SESSION_ID);
    // Reset caches — values become stale on disconnect, and yesterday's close
    // needs to be re-acquired from the fresh stream.
    this.vixCache = {};
    this.spxCache = {};
  }

  private applyTick(cache: TickCache, data: StreamTickData) {
    // IBKR returns -1 / 0 as sentinels for missing data; only accept positive prices.
    if (data.last != null && data.last > 0) cache.last = data.last;
    if (data.close != null && data.close > 0) cache.close = data.close;
  }

  private async refreshGexLevels() {
    try {
      const analysis = await getGexAnalysis("SPX", null, true, true);
      this.gexLevels = {
        gexFlip: analysis.levels.gexFlip,
        putWall: analysis.levels.putWall.strike,
        callWall: analysis.levels.callWall.strike,
        netGEXRegime: analysis.summary.netGEXRegime,
        fetchedAt: analysis.fetchedAt,
      };
    } catch {
      // Keep previous cached value; if none exists, gexLevels stays null
    }
  }

  private async tick() {
    if (sseService.getClientCount() === 0) return;
    if (!ibkrService.isConnected()) return;

    try {
      const macro = await this.buildLiveMacro();
      if (macro) {
        this.lastBroadcast = macro;
        sseService.broadcast("macro", macro);
      }
    } catch {
      // Silent — don't spam logs for transient errors
    }
  }

  private async buildLiveMacro() {
    const vix = this.vixCache.last ?? null;
    const sp500Index = this.spxCache.last ?? null;

    if (vix == null && sp500Index == null) return null;

    // Load the latest stored macro snapshot for baseline data (SMA, RSI, etc.)
    if (!this.lastSnapshot) {
      const snapshot = await prisma.macroSnapshot.findFirst({
        orderBy: { analyzedAt: "desc" },
      });
      if (snapshot?.details) {
        this.lastSnapshot = snapshot.details as Record<string, unknown>;
      }
    }

    const baseline = this.lastSnapshot ?? {};

    const vixPrevClose = this.vixCache.close ?? null;
    const spxPrevClose = this.spxCache.close ?? null;

    const vixChange = vix != null && vixPrevClose != null
      ? Math.round((vix - vixPrevClose) * 100) / 100
      : (baseline.vixChange as number | null) ?? null;

    const sp500Change = sp500Index != null && spxPrevClose != null && spxPrevClose > 0
      ? Math.round(((sp500Index - spxPrevClose) / spxPrevClose) * 10000) / 100
      : (baseline.sp500Change as number | null) ?? null;

    return {
      regime: baseline.regime ?? "neutral",
      confidence: 0.5,
      summary: "",
      analyzedAt: new Date().toISOString(),
      details: {
        ...baseline,
        // Override with live values
        ...(vix != null ? { vix } : {}),
        ...(vixChange != null ? { vixChange } : {}),
        ...(sp500Index != null ? { sp500Index } : {}),
        ...(sp500Change != null ? { sp500Change } : {}),
        ...(this.gexLevels ? { gexLevels: this.gexLevels } : {}),
      },
    };
  }

  /** Called when daily macro snapshot is refreshed to update the baseline */
  invalidateBaseline() {
    this.lastSnapshot = null;
  }

  /** Returns the last broadcast result, or null if no broadcast has happened yet */
  getLastBroadcast(): Record<string, unknown> | null {
    return this.lastBroadcast;
  }
}

export const macroBroadcastService = new MacroBroadcastService();
