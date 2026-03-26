import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { macroCollector } from "./collectors/macro.collector.js";
import { macroAnalyzer } from "./analyzers/macro.analyzer.js";
import { isSkipped } from "./collectors/types.js";

const FRESHNESS_HOURS = 24;

function signalToRegime(signal: string): string {
  switch (signal) {
    case "bullish":
      return "risk_on";
    case "bearish":
      return "risk_off";
    default:
      return "neutral";
  }
}

class MacroService {
  /**
   * Collect macro data and analyze it, storing the result as a MacroSnapshot.
   * If a fresh snapshot exists (< 24h old) and force is not set, returns it directly.
   */
  async collectAndAnalyze(force = false) {
    // Check if latest snapshot is still fresh
    if (!force) {
      const existing = await prisma.macroSnapshot.findFirst({
        orderBy: { analyzedAt: "desc" },
      });

      if (existing) {
        const ageMs = Date.now() - existing.analyzedAt.getTime();
        const freshnessMs = FRESHNESS_HOURS * 60 * 60 * 1000;
        if (ageMs < freshnessMs) {
          return existing;
        }
      }
    }

    // Collect macro data (symbol is ignored by macro collector)
    const collected = await macroCollector.collect("");

    if (isSkipped(collected)) {
      throw new Error(`Macro collection skipped: ${collected.reason}`);
    }

    // Analyze the collected data
    const analysis = await macroAnalyzer.analyze(collected.data);

    // Map signal to regime
    const regime = signalToRegime(analysis.signal);

    // Store as MacroSnapshot
    const snapshot = await prisma.macroSnapshot.create({
      data: {
        regime,
        confidence: analysis.confidence,
        summary: analysis.summary,
        details: analysis.details as Prisma.InputJsonValue,
      },
    });

    return snapshot;
  }
}

export const macroService = new MacroService();
