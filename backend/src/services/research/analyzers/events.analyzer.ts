import type { Analyzer, AnalysisOutput } from "./types.js";
import type { EarningsEvent, DividendEvent } from "../providers/index.js";

interface EarningsSurprise {
  quarter: string;
  estimateEps: number | null;
  actualEps: number | null;
  surprise: "beat" | "miss" | "meet" | "unknown";
}

interface EventsDetails {
  nextEarnings: string | null;
  earningsBeatRate: number;
  recentEarningsSurprises: EarningsSurprise[];
  nextExDividend: string | null;
  dividendAmount: number | null;
  dividendYield: number | null;
  dividendGrowth: "growing" | "stable" | "declining" | "none";
}

function classifyEarningsSurprise(
  event: EarningsEvent
): EarningsSurprise["surprise"] {
  if (event.actualEps === null || event.estimateEps === null) return "unknown";
  const diff = event.actualEps - event.estimateEps;
  if (diff > 0.005) return "beat";
  if (diff < -0.005) return "miss";
  return "meet";
}

function getNextEarningsDate(earnings: EarningsEvent[]): string | null {
  const now = new Date().toISOString().split("T")[0];
  const future = earnings
    .filter((e) => e.date >= now)
    .sort((a, b) => a.date.localeCompare(b.date));
  return future.length > 0 ? future[0].date : null;
}

function getRecentSurprises(
  earnings: EarningsEvent[],
  count: number
): EarningsSurprise[] {
  const past = earnings
    .filter((e) => e.actualEps !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, count);

  return past.map((e) => ({
    quarter: e.quarter,
    estimateEps: e.estimateEps,
    actualEps: e.actualEps,
    surprise: classifyEarningsSurprise(e),
  }));
}

function computeBeatRate(surprises: EarningsSurprise[]): number {
  const known = surprises.filter((s) => s.surprise !== "unknown");
  if (known.length === 0) return 0;
  const beats = known.filter((s) => s.surprise === "beat").length;
  return beats / known.length;
}

function getNextExDividend(dividends: DividendEvent[]): DividendEvent | null {
  const now = new Date().toISOString().split("T")[0];
  const future = dividends
    .filter((d) => d.exDate >= now)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  return future.length > 0 ? future[0] : null;
}

function classifyDividendGrowth(
  dividends: DividendEvent[]
): EventsDetails["dividendGrowth"] {
  if (dividends.length === 0) return "none";

  // Sort chronologically and take the last several dividends with amounts
  const sorted = [...dividends]
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));

  if (sorted.length < 2) return "stable";

  // Compare recent dividend to older ones
  const recent = sorted[sorted.length - 1].amount;
  const older = sorted[Math.max(0, sorted.length - 4)].amount;

  if (older === 0) return "stable";

  const changeRate = (recent - older) / older;

  if (changeRate > 0.02) return "growing";
  if (changeRate < -0.02) return "declining";
  return "stable";
}

export const eventsAnalyzer: Analyzer = {
  source: "events",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const earnings = (rawData.earnings as EarningsEvent[] | null) ?? [];
    const dividends = (rawData.dividends as DividendEvent[] | null) ?? [];

    // Earnings analysis
    const nextEarnings = getNextEarningsDate(earnings);
    const recentSurprises = getRecentSurprises(earnings, 4);
    const beatRate = computeBeatRate(recentSurprises);

    // Dividend analysis
    const nextDividendEvent = getNextExDividend(dividends);
    const dividendGrowth = classifyDividendGrowth(dividends);

    // Determine the most recent dividend amount
    const sortedDividends = [...dividends]
      .filter((d) => d.amount > 0)
      .sort((a, b) => b.exDate.localeCompare(a.exDate));
    const latestDividendAmount =
      sortedDividends.length > 0 ? sortedDividends[0].amount : null;

    // Build details
    const details: EventsDetails = {
      nextEarnings,
      earningsBeatRate: beatRate,
      recentEarningsSurprises: recentSurprises,
      nextExDividend: nextDividendEvent?.exDate ?? null,
      dividendAmount: nextDividendEvent?.amount ?? latestDividendAmount,
      dividendYield: null, // Would need current price; not available in raw events data
      dividendGrowth,
    };

    // Score signals
    let score = 0;
    const signals: string[] = [];

    // Earnings beat pattern
    const knownSurprises = recentSurprises.filter(
      (s) => s.surprise !== "unknown"
    );
    if (knownSurprises.length > 0) {
      const beats = knownSurprises.filter((s) => s.surprise === "beat").length;
      const misses = knownSurprises.filter((s) => s.surprise === "miss").length;

      if (beats > misses) {
        score += 1;
        signals.push(
          `Earnings beat pattern (${beats}/${knownSurprises.length} beats)`
        );
      } else if (misses > beats) {
        score -= 1;
        signals.push(
          `Earnings miss pattern (${misses}/${knownSurprises.length} misses)`
        );
      }

      if (beatRate >= 0.75) {
        score += 1;
        signals.push(`Strong beat rate (${(beatRate * 100).toFixed(0)}%)`);
      } else if (beatRate <= 0.25 && knownSurprises.length >= 2) {
        score -= 1;
        signals.push(`Weak beat rate (${(beatRate * 100).toFixed(0)}%)`);
      }
    }

    // Upcoming catalyst (earnings within 30 days)
    if (nextEarnings) {
      const daysUntil = Math.ceil(
        (new Date(nextEarnings).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntil >= 0 && daysUntil <= 30) {
        score += 1;
        signals.push(`Upcoming earnings catalyst in ${daysUntil} days`);
      }
    }

    // Dividend growth
    if (dividendGrowth === "growing") {
      score += 1;
      signals.push("Dividend growth trend");
    } else if (dividendGrowth === "declining") {
      score -= 1;
      signals.push("Dividend declining (potential cut risk)");
    }

    // Determine signal
    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 4, 1);

    const summary =
      signals.length > 0
        ? signals.slice(0, 3).join(". ") + "."
        : "No significant events signals.";

    return {
      signal,
      confidence,
      summary,
      details: details as unknown as Record<string, unknown>,
    };
  },
};
