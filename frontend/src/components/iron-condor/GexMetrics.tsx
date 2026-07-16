import { Card, CardContent } from "@/components/ui/card";
import type { GexKeyLevels, GexSummary } from "@assup/shared";

interface GexMetricsProps {
  levels: GexKeyLevels;
  summary: GexSummary;
  spot: number;
}

function formatOI(oi: number): string {
  if (oi >= 1_000_000) return `${(oi / 1_000_000).toFixed(1)}M`;
  if (oi >= 1_000) return `${(oi / 1_000).toFixed(1)}k`;
  return String(oi);
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  explanation: string;
  valueClassName?: string;
}

function MetricCard({ label, value, detail, explanation, valueClassName }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
        <div className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed border-t pt-2">{explanation}</div>
      </CardContent>
    </Card>
  );
}

export function GexMetrics({ levels, summary, spot }: GexMetricsProps) {
  const putWallDist = spot > 0 ? ((spot - levels.putWall.strike) / spot * 100).toFixed(1) : "\u2014";
  const callWallDist = spot > 0 ? ((levels.callWall.strike - spot) / spot * 100).toFixed(1) : "\u2014";

  const isPositive = summary.netGEXRegime === "positive";

  return (
    <div className="grid grid-cols-4 gap-3">
      <MetricCard
        label="Put Wall (Support)"
        value={formatPrice(levels.putWall.strike)}
        detail={`OI: ${formatOI(levels.putWall.oi)} \u00B7 ${putWallDist}% below`}
        explanation="Strike with the highest put open interest. Dealers who sold these puts must buy the underlying as price drops toward this level, creating a floor. Sell put spreads above this level for protection."
        valueClassName="text-red-500"
      />
      <MetricCard
        label="Call Wall (Resistance)"
        value={formatPrice(levels.callWall.strike)}
        detail={`OI: ${formatOI(levels.callWall.oi)} \u00B7 ${callWallDist}% above`}
        explanation="Strike with the highest call open interest. Dealers who sold these calls must sell the underlying as price rises toward this level, creating a ceiling. Sell call spreads below this level for protection."
        valueClassName="text-blue-500"
      />
      <MetricCard
        label="GEX Flip"
        value={summary.gexFlipLevel != null ? formatPrice(summary.gexFlipLevel) : "\u2014"}
        detail={summary.gexFlipLevel != null
          ? `${spot > summary.gexFlipLevel ? "Price above" : "Price below"} flip`
          : "No crossover found"}
        explanation={summary.gexFlipLevel != null
          ? "The price level where net gamma exposure crosses zero. Above the flip, dealer hedging dampens moves (mean-reverting). Below, hedging amplifies moves (trending). Safer to sell premium when price is above the flip."
          : "No gamma crossover found near the current price. All nearby strikes have the same gamma sign."}
        valueClassName="text-yellow-500"
      />
      <MetricCard
        label="Dealer Regime"
        value={isPositive ? "Positive \u03B3" : "Negative \u03B3"}
        detail={isPositive
          ? "Moves dampened \u00B7 Safer to sell"
          : "Moves amplified \u00B7 Higher risk"}
        explanation={isPositive
          ? "Dealers are long gamma near the current price. They buy dips and sell rallies to hedge, compressing volatility. Good environment for selling premium \u2014 price tends to stay range-bound."
          : "Dealers are short gamma near the current price. They must sell into drops and buy into rallies, amplifying moves. Riskier for selling premium \u2014 breakouts are more likely."}
        valueClassName={isPositive ? "text-green-500" : "text-red-500"}
      />
    </div>
  );
}
