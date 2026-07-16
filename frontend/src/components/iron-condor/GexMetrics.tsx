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
  hint?: string;
  valueClassName?: string;
}

function MetricCard({ label, value, detail, hint, valueClassName }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
        {hint && <div className="text-[10px] text-muted-foreground/70 mt-1 leading-tight">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function GexMetrics({ levels, summary, spot }: GexMetricsProps) {
  const putWallDist = spot > 0 ? ((spot - levels.putWall.strike) / spot * 100).toFixed(1) : "—";
  const callWallDist = spot > 0 ? ((levels.callWall.strike - spot) / spot * 100).toFixed(1) : "—";

  return (
    <div className="grid grid-cols-4 gap-3">
      <MetricCard
        label="Put Wall (Support)"
        value={formatPrice(levels.putWall.strike)}
        detail={`OI: ${formatOI(levels.putWall.oi)} · ${putWallDist}% below`}
        hint="Dealers hedge here by buying — cushions drops"
        valueClassName="text-red-500"
      />
      <MetricCard
        label="Call Wall (Resistance)"
        value={formatPrice(levels.callWall.strike)}
        detail={`OI: ${formatOI(levels.callWall.oi)} · ${callWallDist}% above`}
        hint="Dealers hedge here by selling — caps rallies"
        valueClassName="text-blue-500"
      />
      <MetricCard
        label="GEX Flip"
        value={summary.gexFlipLevel != null ? formatPrice(summary.gexFlipLevel) : "—"}
        detail={summary.gexFlipLevel != null
          ? `${spot > summary.gexFlipLevel ? "Price above" : "Price below"} flip`
          : "No crossover found"}
        hint={summary.gexFlipLevel != null
          ? "Below flip: moves amplified. Above: moves dampened"
          : undefined}
        valueClassName="text-yellow-500"
      />
      <MetricCard
        label="Dealer Regime"
        value={summary.netGEXRegime === "positive" ? "Positive" : "Negative"}
        detail={summary.netGEXRegime === "positive"
          ? "Moves dampened · Safer to sell"
          : "Moves amplified · Higher risk"}
        valueClassName={summary.netGEXRegime === "positive" ? "text-green-500" : "text-red-500"}
      />
    </div>
  );
}
