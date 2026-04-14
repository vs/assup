import type { MacroAnalysis, MarketRegime } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

// --- Regime config ---

const regimeConfig: Record<
  MarketRegime,
  { label: string; bg: string; text: string; border: string }
> = {
  risk_on: {
    label: "Risk On",
    bg: "bg-green-500/10",
    text: "text-green-700",
    border: "border-green-500/20",
  },
  risk_off: {
    label: "Risk Off",
    bg: "bg-red-500/10",
    text: "text-red-700",
    border: "border-red-500/20",
  },
  neutral: {
    label: "Neutral",
    bg: "bg-amber-500/10",
    text: "text-amber-700",
    border: "border-amber-500/20",
  },
};

// --- Fear Score ---

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

interface FearScoreResult {
  score: number;
  label: string;
  components: { name: string; display: string; change?: number | null }[];
}

function computeFearScore(
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
      .map((s) => ({ name: s.name, display: s.display, change: s.change })),
  };
}

// --- Sub-components ---

function DailyChangeArrow({ change }: { change: number }) {
  const threshold = 0.05;
  if (Math.abs(change) < threshold) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (change > 0) {
    return (
      <span className="inline-flex items-center text-green-600">
        <TrendingUp className="h-3.5 w-3.5" />
        <span className="text-xs font-medium ml-0.5">
          +{change.toFixed(1)}%
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-red-600">
      <TrendingDown className="h-3.5 w-3.5" />
      <span className="text-xs font-medium ml-0.5">{change.toFixed(1)}%</span>
    </span>
  );
}

function FearGauge({ details }: { details: MacroAnalysis["details"] }) {
  const result = computeFearScore(details);
  if (!result)
    return <span className="text-xs text-muted-foreground">No data</span>;

  const labelColor =
    result.score < 20
      ? "text-green-600"
      : result.score < 40
        ? "text-green-500"
        : result.score < 60
          ? "text-amber-500"
          : result.score < 80
            ? "text-orange-500"
            : "text-red-600";

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 min-w-[180px]">
        <span className={`text-lg font-bold tabular-nums ${labelColor}`}>
          {result.score}
        </span>
        <div
          className="relative flex-1 h-2.5 rounded-full overflow-hidden"
          style={{
            background:
              "linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)",
          }}
        >
          <div
            className="absolute top-[-1px] w-[3px] h-[12px] bg-white rounded-full border border-gray-500"
            style={{
              left: `${result.score}%`,
              transform: "translateX(-50%)",
            }}
          />
        </div>
        <span className={`text-sm font-semibold whitespace-nowrap ${labelColor}`}>
          {result.label}
        </span>
      </div>
      <div className="hidden lg:flex items-center gap-4 text-sm text-muted-foreground">
        {result.components.map((c) => (
          <span key={c.name} className="flex items-center gap-1">
            {c.name}: <span className="font-semibold">{c.display}</span>
            {c.change != null && <DailyChangeArrow change={c.change} />}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Main Component ---

interface MacroBannerProps {
  macro: MacroAnalysis | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function MacroBanner({ macro, onRefresh, refreshing }: MacroBannerProps) {
  if (!macro) return null;

  const config = regimeConfig[macro.regime];

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-4">
          <Badge
            variant="outline"
            className={`${config.text} ${config.border} font-semibold text-sm px-3 py-0.5`}
          >
            {config.label}
          </Badge>
          <FearGauge details={macro.details} />
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="ml-auto h-7 px-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
