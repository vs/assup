import { Card, CardContent } from "@/components/ui/card";
import type { GexKeyLevels } from "@assup/shared";

/** All-expiries flip and net GEX at spot from the dealer gamma profile, which loads separately. */
export type GexProfileState =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; flip: number | null; netGEX: number };

interface GexMetricsProps {
  levels: GexKeyLevels;
  spot: number;
  profile: GexProfileState;
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

const PROFILE_LOADING = { value: "\u2026", detail: "Loading all expirations", explanation: "Computed from every listed expiration, shown in the dealer gamma chart above." };
const PROFILE_ERROR = { value: "\u2014", detail: "Dealer gamma profile unavailable", explanation: "The all-expirations fetch failed. See the error above the chart." };

function formatBillions(v: number): string {
  return `${v < 0 ? "\u2212" : "+"}$${(Math.abs(v) / 1e9).toFixed(1)}B`;
}

function flipCard(profile: GexProfileState, spot: number): Omit<MetricCardProps, "label" | "valueClassName"> {
  if (profile.state === "loading") return PROFILE_LOADING;
  if (profile.state === "error") return PROFILE_ERROR;
  const level = profile.flip;
  if (level == null) {
    return {
      value: "\u2014",
      detail: "No crossover within \u00B15%",
      explanation: "Total net gamma keeps the same sign for every price within 5% of spot, so there is no flip nearby.",
    };
  }
  return {
    value: formatPrice(level),
    detail: `${spot > level ? "Price above" : "Price below"} flip \u00B7 all expiries`,
    explanation: "The price where total net gamma across all expirations would cross zero if price moved there (the Flip Line in the chart above). Above the flip, dealer hedging dampens moves (mean-reverting). Below, hedging amplifies moves (trending). Safer to sell premium when price is above the flip.",
  };
}

function regimeCard(profile: GexProfileState): MetricCardProps {
  const label = "Dealer Regime";
  if (profile.state === "loading") return { label, ...PROFILE_LOADING };
  if (profile.state === "error") return { label, ...PROFILE_ERROR };
  const isPositive = profile.netGEX >= 0;
  return {
    label,
    value: isPositive ? "Positive \u03B3" : "Negative \u03B3",
    detail: `${isPositive ? "Moves dampened \u00B7 Safer to sell" : "Moves amplified \u00B7 Higher risk"} \u00B7 net ${formatBillions(profile.netGEX)}`,
    explanation: isPositive
      ? "Dealers are long gamma at the current price (total net GEX across all expirations is positive). They buy dips and sell rallies to hedge, compressing volatility. Good environment for selling premium \u2014 price tends to stay range-bound."
      : "Dealers are short gamma at the current price (total net GEX across all expirations is negative). They must sell into drops and buy into rallies, amplifying moves. Riskier for selling premium \u2014 breakouts are more likely.",
    valueClassName: isPositive ? "text-green-500" : "text-red-500",
  };
}

export function GexMetrics({ levels, spot, profile }: GexMetricsProps) {
  const putWallDist = spot > 0 ? ((spot - levels.putWall.strike) / spot * 100).toFixed(1) : "\u2014";
  const callWallDist = spot > 0 ? ((levels.callWall.strike - spot) / spot * 100).toFixed(1) : "\u2014";

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
      <MetricCard label="GEX Flip" {...flipCard(profile, spot)} valueClassName="text-yellow-500" />
      <MetricCard {...regimeCard(profile)} />
    </div>
  );
}
