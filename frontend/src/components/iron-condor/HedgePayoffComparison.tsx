/**
 * Hedge Wizard Step 3: Payoff Comparison
 * Shows a before/after payoff chart and metrics table side by side.
 */

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PayoffComparisonChart } from "./PayoffComparisonChart";
import type { HedgedPayoffResult } from "@/utils/spreadAnalysis";

interface HedgePayoffComparisonProps {
  beforeCurve: Array<{ price: number; pnl: number }>;
  afterResult: HedgedPayoffResult;
  beforeMaxProfit: number;
  beforeMaxLoss: number;
  underlyingPrice: number;
  strikes: Array<{ strike: number; label: string }>;
  onBack: () => void;
  onNext: () => void;
}

function fmtDollars(v: number): string {
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function HedgePayoffComparison({
  beforeCurve,
  afterResult,
  beforeMaxProfit,
  beforeMaxLoss,
  underlyingPrice,
  strikes,
  onBack,
  onNext,
}: HedgePayoffComparisonProps) {
  const lossReduction =
    beforeMaxLoss > 0
      ? Math.round((1 - afterResult.maxLoss / beforeMaxLoss) * 100)
      : 0;

  const profitChanged = afterResult.maxProfit !== beforeMaxProfit;
  const profitDelta = afterResult.maxProfit - beforeMaxProfit;

  // The hedge can paradoxically widen worst-case loss (e.g. an inverted
  // butterfly built from a debit-spread overlay puts the new max-loss point
  // at the long strike). Surface this loudly so the user doesn't read
  // "hedge" as "guaranteed risk reduction".
  const lossWorsened = afterResult.maxLoss > beforeMaxLoss;
  const lossDelta = afterResult.maxLoss - beforeMaxLoss;

  return (
    <div className="space-y-4">
      {/* Title */}
      <p className="text-sm font-semibold">Payoff Comparison</p>

      {lossWorsened && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="text-xs leading-relaxed">
            <span className="font-semibold">This hedge increases worst-case loss</span> by {fmtDollars(lossDelta)} ({fmtDollars(beforeMaxLoss)} &rarr; {fmtDollars(afterResult.maxLoss)}). The position profits only if the underlying moves past one of the wings; if it pins near the long strike at expiry, you lose more than the original spread's max loss.
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="border rounded-lg overflow-hidden">
        <PayoffComparisonChart
          beforeCurve={beforeCurve}
          afterCurve={afterResult.payoffCurve}
          underlyingPrice={underlyingPrice}
          strikes={strikes}
        />
      </div>

      {/* Comparison table */}
      <div className="border rounded-lg overflow-hidden text-sm">
        {/* Header row */}
        <div className="grid grid-cols-3 divide-x bg-blue-50 border-b">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground" />
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
            Before (Spread)
          </div>
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
            After (Hedged)
          </div>
        </div>

        {/* Max profit row */}
        <div className="grid grid-cols-3 divide-x border-b">
          <div className="px-3 py-2 text-muted-foreground text-xs font-medium">
            Max profit
          </div>
          <div className="px-3 py-2 font-semibold text-green-700 tabular-nums">
            {fmtDollars(beforeMaxProfit)}
          </div>
          <div className="px-3 py-2 font-semibold text-green-700 tabular-nums">
            {fmtDollars(afterResult.maxProfit)}
            {profitChanged && (
              <span
                className={`ml-2 text-xs font-normal ${
                  profitDelta >= 0 ? "text-green-600" : "text-red-500"
                }`}
              >
                ({profitDelta >= 0 ? "+" : ""}
                {fmtDollars(profitDelta)})
              </span>
            )}
          </div>
        </div>

        {/* Max loss row */}
        <div className="grid grid-cols-3 divide-x border-b">
          <div className="px-3 py-2 text-muted-foreground text-xs font-medium">
            Max loss
          </div>
          <div className="px-3 py-2 font-semibold text-red-700 tabular-nums">
            {fmtDollars(beforeMaxLoss)}
          </div>
          <div className="px-3 py-2 font-semibold text-red-700 tabular-nums">
            {fmtDollars(afterResult.maxLoss)}
            {lossReduction > 0 && (
              <span className="ml-2 text-xs font-normal text-green-600">
                (-{lossReduction}%)
              </span>
            )}
          </div>
        </div>

        {/* Hedge cost row */}
        <div className="grid grid-cols-3 divide-x border-b">
          <div className="px-3 py-2 text-muted-foreground text-xs font-medium">
            Hedge cost
          </div>
          <div className="px-3 py-2 text-muted-foreground tabular-nums">
            &mdash;
          </div>
          <div className="px-3 py-2 font-semibold text-red-700 tabular-nums">
            {fmtDollars(afterResult.hedgeCost)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              debit
            </span>
          </div>
        </div>

        {/* Breakeven row */}
        <div className="grid grid-cols-3 divide-x">
          <div className="px-3 py-2 text-muted-foreground text-xs font-medium">
            Breakeven
          </div>
          <div className="px-3 py-2 tabular-nums text-muted-foreground">
            &mdash;
          </div>
          <div className="px-3 py-2 tabular-nums">
            {afterResult.breakEvenLow != null ||
            afterResult.breakEvenHigh != null ? (
              <span className="text-foreground">
                {[afterResult.breakEvenLow, afterResult.breakEvenHigh]
                  .filter((v): v is number => v != null)
                  .map((v) =>
                    v.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  )
                  .join(" / ")}
              </span>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onBack}>
          &larr; Adjust Strikes
        </Button>
        <Button onClick={onNext}>Confirm Order &rarr;</Button>
      </div>
    </div>
  );
}
