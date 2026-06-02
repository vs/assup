/**
 * Periodic macro data broadcaster.
 * Fetches live VIX and SPX prices from IBKR every 5 seconds,
 * merges with the latest stored macro snapshot, and broadcasts
 * via SSE so the frontend fear/greed gauge stays live.
 */

import { Contract, SecType } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { sseService } from "./sse.js";
import { prisma } from "../db/index.js";

const VIX_CONTRACT: Contract = { symbol: "VIX", secType: SecType.IND, exchange: "CBOE", currency: "USD" };
const SPX_CONTRACT: Contract = { symbol: "SPX", secType: SecType.IND, exchange: "CBOE", currency: "USD" };

const BROADCAST_INTERVAL_MS = 5_000;

class MacroBroadcastService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: Record<string, unknown> | null = null;

  start() {
    if (this.timer) return;
    console.log("[MacroBroadcast] Starting live macro broadcasts every 5s");
    // Don't broadcast immediately — wait for first interval so IBKR connection is stable
    this.timer = setInterval(() => this.tick(), BROADCAST_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    // Only broadcast if clients are listening and IBKR is connected
    if (sseService.getClientCount() === 0) return;
    if (!ibkrService.isConnected()) return;

    try {
      const macro = await this.buildLiveMacro();
      if (macro) {
        sseService.broadcast("macro", macro);
      }
    } catch {
      // Silent — don't spam logs for transient IBKR errors
    }
  }

  private async buildLiveMacro() {
    // Fetch live VIX and SPX in parallel
    const [vixData, spxData] = await Promise.all([
      ibkrService.getMarketData(VIX_CONTRACT).catch(() => null),
      ibkrService.getMarketData(SPX_CONTRACT).catch(() => null),
    ]);

    const vix = vixData?.last || vixData?.close || null;
    const sp500Index = spxData?.last || spxData?.close || null;

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

    // Compute changes from previous close if available
    const baselineVix = baseline.vix as number | null | undefined;
    const baselineSp500 = baseline.sp500Index as number | null | undefined;

    const vixChange = vix != null && baselineVix != null
      ? Math.round((vix - baselineVix) * 100) / 100
      : (baseline.vixChange as number | null) ?? null;

    const sp500Change = sp500Index != null && baselineSp500 != null && baselineSp500 > 0
      ? Math.round(((sp500Index - baselineSp500) / baselineSp500) * 10000) / 100
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
      },
    };
  }

  /** Called when daily macro snapshot is refreshed to update the baseline */
  invalidateBaseline() {
    this.lastSnapshot = null;
  }
}

export const macroBroadcastService = new MacroBroadcastService();
