import type { MacroAnalysis } from "@assup/shared";

export interface FearComponent {
  name: string;
  display: string;
  change?: number | null;
  score: number;
  weight: number;
}

export interface FearScoreResult {
  score: number;
  label: string;
  components: FearComponent[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function linearMap(
  v: number,
  inLow: number,
  inHigh: number,
  outLow: number,
  outHigh: number,
): number {
  return clamp(
    outLow + ((v - inLow) / (inHigh - inLow)) * (outHigh - outLow),
    Math.min(outLow, outHigh),
    Math.max(outLow, outHigh),
  );
}

export function computeFearScore(
  details: MacroAnalysis["details"],
): FearScoreResult | null {
  const signals: {
    score: number;
    weight: number;
    name: string;
    display: string;
    change?: number | null;
  }[] = [];

  if (details.vix != null) {
    const s =
      details.vix <= 20
        ? linearMap(details.vix, 12, 20, 0, 50)
        : linearMap(details.vix, 20, 35, 50, 100);
    signals.push({
      score: s,
      weight: 0.3,
      name: "VIX",
      display: details.vix.toFixed(1),
      change: details.vixChange,
    });
  }

  if (details.vix != null && details.vixSma20 != null && details.vixSma20 > 0) {
    const pctDiff =
      ((details.vix - details.vixSma20) / details.vixSma20) * 100;
    const s = linearMap(pctDiff, -15, 15, 0, 100);
    signals.push({ score: s, weight: 0.1, name: "", display: "" });
  }

  if (
    details.sp500Index != null &&
    details.sp500Sma200 != null &&
    details.sp500Sma200 > 0
  ) {
    const pctAbove =
      ((details.sp500Index - details.sp500Sma200) / details.sp500Sma200) * 100;
    const s = linearMap(pctAbove, 10, -10, 0, 100);
    const displayPrice = details.sp500Index.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
    signals.push({
      score: s,
      weight: 0.15,
      name: "S&P 500",
      display: displayPrice,
      change: details.sp500Change,
    });
  }

  if (details.sp500Rsi != null) {
    const s = linearMap(details.sp500Rsi, 70, 30, 0, 100);
    signals.push({
      score: s,
      weight: 0.1,
      name: "RSI",
      display: details.sp500Rsi.toFixed(0),
    });
  }

  if (details.safeHavenSpread != null) {
    const s = linearMap(details.safeHavenSpread, 3, -3, 0, 100);
    signals.push({
      score: s,
      weight: 0.15,
      name: "HYG/TLT",
      display: `${details.safeHavenSpread >= 0 ? "+" : ""}${details.safeHavenSpread.toFixed(1)}%`,
    });
  }

  if (details.sp500Change != null) {
    const s = linearMap(details.sp500Change, 2, -2, 0, 100);
    signals.push({
      score: s,
      weight: 0.1,
      name: "Momentum",
      display: `${details.sp500Change >= 0 ? "+" : ""}${details.sp500Change.toFixed(1)}%`,
    });
  }

  if (details.putCallRatio != null) {
    const s =
      details.putCallRatio <= 0.85
        ? linearMap(details.putCallRatio, 0.5, 0.85, 0, 50)
        : linearMap(details.putCallRatio, 0.85, 1.5, 50, 100);
    signals.push({
      score: s,
      weight: 0.1,
      name: "P/C",
      display: details.putCallRatio.toFixed(2),
    });
  }

  if (signals.length === 0) return null;

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = signals.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;

  const label =
    score < 20
      ? "Extreme Greed"
      : score < 40
        ? "Greed"
        : score < 60
          ? "Neutral"
          : score < 80
            ? "Fear"
            : "Extreme Fear";

  return {
    score: Math.round(score),
    label,
    components: signals
      .filter((s) => s.name)
      .map((s) => ({ name: s.name, display: s.display, change: s.change, score: Math.round(s.score), weight: s.weight })),
  };
}

export function getLabelColor(score: number): string {
  if (score < 20) return "text-green-600";
  if (score < 40) return "text-green-500";
  if (score < 60) return "text-amber-500";
  if (score < 80) return "text-orange-500";
  return "text-red-600";
}
