/**
 * Periodic macro data broadcaster.
 * Subscribes once to streaming VIX and SPX market data, caches the latest
 * tick values, and broadcasts every 5 seconds via SSE so the frontend
 * fear/greed gauge stays live. Streaming avoids the per-poll snapshot races
 * that left the LAST tick missing for indices. The QuoteHub leases survive
 * TWS reconnects, so the streams are opened once in start().
 */

import { ibkrService } from "./ibkr.js";
import { sseService } from "./sse.js";
import { prisma } from "../db/index.js";
import { getGexAnalysis } from "./gex.service.js";
import { quoteHub, type Quote, type QuoteContract, type QuoteLease } from "./quotes/index.js";
import type { MacroGexLevels } from "@assup/shared";

const VIX_CONTRACT: QuoteContract = { symbol: "VIX", secType: "IND", exchange: "CBOE", currency: "USD" };
const SPX_CONTRACT: QuoteContract = { symbol: "SPX", secType: "IND", exchange: "CBOE", currency: "USD" };

const BROADCAST_INTERVAL_MS = 5_000;

interface TickCache {
  last?: number;
  close?: number;
}

/** IBKR sends -1 / 0 as sentinels for missing index data; only positive prices count. */
function pricesFrom(q: Quote): TickCache {
  return {
    last: q.last != null && q.last > 0 ? q.last : undefined,
    close: q.close != null && q.close > 0 ? q.close : undefined,
  };
}

class MacroBroadcastService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: Record<string, unknown> | null = null;
  private lastBroadcast: Record<string, unknown> | null = null;
  private gexLevels: MacroGexLevels | null = null;
  private gexTimer: ReturnType<typeof setInterval> | null = null;
  private vixCache: TickCache = {};
  private spxCache: TickCache = {};
  private leases: QuoteLease[] = [];

  start() {
    if (this.timer) return;
    console.log("[MacroBroadcast] Starting live macro broadcasts every 5s");
    this.timer = setInterval(() => this.tick(), BROADCAST_INTERVAL_MS);

    this.subscribeStreams();

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
    this.unsubscribeStreams();
  }

  private subscribeStreams() {
    if (this.leases.length > 0) return;
    this.leases = [
      quoteHub.subscribe(VIX_CONTRACT, (q) => (this.vixCache = pricesFrom(q))),
      quoteHub.subscribe(SPX_CONTRACT, (q) => (this.spxCache = pricesFrom(q))),
    ];
    for (const lease of this.leases) {
      const q = lease.quote();
      if (q.status === "no-lines" || q.error) {
        console.warn(`[MacroBroadcast] ${lease.key}: ${q.status}${q.error ? ` — ${q.error}` : ""}`);
      }
    }
    console.log("[MacroBroadcast] Subscribed to VIX/SPX streams");
  }

  private unsubscribeStreams() {
    for (const lease of this.leases) lease.release();
    this.leases = [];
    this.vixCache = {};
    this.spxCache = {};
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
