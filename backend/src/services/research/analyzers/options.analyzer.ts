import type { Analyzer, AnalysisOutput } from "./types.js";
import type { OptionsChainEntry } from "../providers/index.js";

interface UnusualActivity {
  symbol: string;
  expiration: string;
  strike: number;
  right: "C" | "P";
  volume: number;
  openInterest: number;
  ratio: number;
}

interface OptionsDetails {
  avgIV: number;
  ivRank: number;
  putCallRatio: number | null;
  totalPutVolume: number;
  totalCallVolume: number;
  unusualActivity: UnusualActivity[];
  wheelSuitability: number;
}

function calculateAvgIV(chain: OptionsChainEntry[]): number {
  const ivValues = chain
    .map((e) => e.impliedVolatility)
    .filter((iv): iv is number => iv != null && iv > 0);
  if (ivValues.length === 0) return 0;
  return ivValues.reduce((sum, iv) => sum + iv, 0) / ivValues.length;
}

function calculateIVRank(chain: OptionsChainEntry[]): number {
  const ivValues = chain
    .map((e) => e.impliedVolatility)
    .filter((iv): iv is number => iv != null && iv > 0);
  if (ivValues.length < 2) return 50; // default when insufficient data

  const sorted = [...ivValues].sort((a, b) => a - b);
  const minIV = sorted[0];
  const maxIV = sorted[sorted.length - 1];

  if (maxIV === minIV) return 50;

  const avgIV = ivValues.reduce((sum, iv) => sum + iv, 0) / ivValues.length;
  return ((avgIV - minIV) / (maxIV - minIV)) * 100;
}

const MIN_VOLUME_FOR_RATIO = 100;

function calculatePutCallRatio(chain: OptionsChainEntry[]): {
  ratio: number | null;
  totalPutVolume: number;
  totalCallVolume: number;
} {
  let totalPutVolume = 0;
  let totalCallVolume = 0;

  for (const entry of chain) {
    if (entry.right === "P") {
      totalPutVolume += entry.volume;
    } else {
      totalCallVolume += entry.volume;
    }
  }

  // Require minimum volume for a meaningful ratio
  const ratio =
    totalCallVolume >= MIN_VOLUME_FOR_RATIO
      ? totalPutVolume / totalCallVolume
      : null;

  return { ratio, totalPutVolume, totalCallVolume };
}

function findUnusualActivity(chain: OptionsChainEntry[]): UnusualActivity[] {
  const unusual: UnusualActivity[] = [];

  for (const entry of chain) {
    if (entry.openInterest > 0 && entry.volume > 3 * entry.openInterest) {
      unusual.push({
        symbol: entry.symbol,
        expiration: entry.expiration,
        strike: entry.strike,
        right: entry.right,
        volume: entry.volume,
        openInterest: entry.openInterest,
        ratio: entry.volume / entry.openInterest,
      });
    }
  }

  // Sort by ratio descending, return top 10
  unusual.sort((a, b) => b.ratio - a.ratio);
  return unusual.slice(0, 10);
}

function calculateWheelSuitability(
  ivRank: number,
  chain: OptionsChainEntry[]
): number {
  // IV rank component: higher IV rank is better for selling premium (0-0.5)
  const ivScore = Math.min(ivRank / 100, 1) * 0.5;

  // Liquidity component: tighter bid-ask spreads indicate better liquidity (0-0.5)
  const puts = chain.filter((e) => e.right === "P" && e.bid > 0 && e.ask > 0);
  if (puts.length === 0) return ivScore;

  const spreads = puts.map((e) => {
    const mid = (e.bid + e.ask) / 2;
    return mid > 0 ? (e.ask - e.bid) / mid : 1;
  });

  const avgSpreadPct =
    spreads.reduce((sum, s) => sum + s, 0) / spreads.length;

  // Spread < 5% is excellent (0.5), spread > 30% is poor (0)
  const liquidityScore = Math.max(0, Math.min(0.5, (0.3 - avgSpreadPct) * 2));

  return Math.min(1, ivScore + liquidityScore);
}

export const optionsAnalyzer: Analyzer = {
  source: "options",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const chain = (rawData.chain as OptionsChainEntry[] | null) ?? [];

    if (chain.length === 0) {
      return {
        signal: "neutral",
        confidence: 0,
        summary: "No options chain data available.",
        details: {
          avgIV: 0,
          ivRank: 50,
          putCallRatio: null,
          totalPutVolume: 0,
          totalCallVolume: 0,
          unusualActivity: [],
          wheelSuitability: 0,
        },
      };
    }

    const avgIV = calculateAvgIV(chain);
    const ivRank = calculateIVRank(chain);
    const { ratio: putCallRatio, totalPutVolume, totalCallVolume } =
      calculatePutCallRatio(chain);
    const unusualActivity = findUnusualActivity(chain);
    const wheelSuitability = calculateWheelSuitability(ivRank, chain);

    // Score signals
    let score = 0;
    const signals: string[] = [];

    // IV rank signals
    if (ivRank > 50) {
      score += 1;
      signals.push(
        `High IV rank (${ivRank.toFixed(1)}%) - good for selling premium`
      );
    }
    if (ivRank > 75) {
      score += 1;
      signals.push("IV rank very elevated - strong wheel opportunity");
    }
    if (ivRank < 20) {
      score -= 1;
      signals.push(`Low IV rank (${ivRank.toFixed(1)}%) - poor premium environment`);
    }

    // Put/call ratio signals (only when volume is sufficient)
    if (putCallRatio != null) {
      if (putCallRatio < 0.7) {
        score += 1;
        signals.push(
          `Low put/call ratio (${putCallRatio.toFixed(2)}) - bullish sentiment`
        );
      }
      if (putCallRatio > 1.5) {
        score -= 1;
        signals.push(
          `Extreme put/call ratio (${putCallRatio.toFixed(2)}) - heavy put buying`
        );
      }
    }

    // Unusual activity
    if (unusualActivity.length > 0) {
      const callActivity = unusualActivity.filter((a) => a.right === "C");
      const putActivity = unusualActivity.filter((a) => a.right === "P");
      if (callActivity.length > putActivity.length) {
        signals.push(
          `Unusual call activity on ${callActivity.length} strike(s)`
        );
      } else if (putActivity.length > callActivity.length) {
        signals.push(
          `Unusual put activity on ${putActivity.length} strike(s)`
        );
      }
    }

    // Wheel suitability
    if (wheelSuitability > 0.7) {
      signals.push(
        `Strong wheel candidate (score: ${wheelSuitability.toFixed(2)})`
      );
    }

    // Determine signal
    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 4, 1);

    const details: OptionsDetails = {
      avgIV,
      ivRank,
      putCallRatio,
      totalPutVolume,
      totalCallVolume,
      unusualActivity,
      wheelSuitability,
    };

    const summary =
      signals.length > 0
        ? signals.slice(0, 3).join(". ") + "."
        : "Insufficient options data for analysis.";

    return {
      signal,
      confidence,
      summary,
      details: details as unknown as Record<string, unknown>,
    };
  },
};
