/**
 * Right panel: recommendation summary, selected legs, stats cards, payoff diagram, metrics, order button.
 */

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PayoffDiagram } from "./PayoffDiagram";
import type { IronCondorAnalyzeResponse, IronCondorChainStrike, SpreadSelectedLegs, SpreadMode } from "@assup/shared";
import { spreadModeLabel } from "./utils";

interface SpreadAnalysisProps {
  analysis: IronCondorAnalyzeResponse | null;
  selectedLegs: SpreadSelectedLegs;
  chain: IronCondorChainStrike[];
  underlyingPrice: number;
  quantity: number;
  onPlaceOrder: () => void;
  mode: SpreadMode;
  symbol: string;
  loading?: boolean;
}

function getOptionForStrike(chain: IronCondorChainStrike[], strike: number, type: "PUT" | "CALL") {
  const entry = chain.find(c => c.strike === strike);
  return type === "PUT" ? entry?.put : entry?.call;
}

export function SpreadAnalysis({
  analysis,
  selectedLegs,
  chain,
  underlyingPrice,
  quantity,
  onPlaceOrder,
  mode,
  symbol,
  loading,
}: SpreadAnalysisProps) {
  const hasPutSide = mode === "put-spread" || mode === "iron-condor";
  const hasCallSide = mode === "call-spread" || mode === "iron-condor";

  const legsReady = (hasPutSide ? selectedLegs.buyPut && selectedLegs.sellPut : true)
    && (hasCallSide ? selectedLegs.sellCall && selectedLegs.buyCall : true);

  if (!legsReady) {
    if (loading) {
      return (
        <div className="space-y-4">
          {/* Recommendation skeleton */}
          <div className="border rounded-lg p-5 space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="text-center space-y-2">
                <Skeleton className="h-7 w-16 mx-auto" />
                <Skeleton className="h-3 w-20 mx-auto" />
              </div>
              <div className="text-center space-y-2">
                <Skeleton className="h-7 w-20 mx-auto" />
                <Skeleton className="h-3 w-24 mx-auto" />
              </div>
              <div className="text-center space-y-2">
                <Skeleton className="h-7 w-20 mx-auto" />
                <Skeleton className="h-3 w-16 mx-auto" />
              </div>
            </div>
          </div>
          {/* Legs + stats skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
            <div className="border rounded-lg p-4 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="border rounded-lg p-3 text-center space-y-2">
                  <Skeleton className="h-3 w-16 mx-auto" />
                  <Skeleton className="h-6 w-20 mx-auto" />
                </div>
              ))}
            </div>
          </div>
          {/* Chart skeleton */}
          <div className="border rounded-lg p-4">
            <Skeleton className="h-3 w-28 mb-3" />
            <Skeleton className="h-[320px] w-full" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Adjust parameters above to generate a recommendation, or click strikes in the chain to build manually.
      </div>
    );
  }

  // Build leg list for display
  const legEntries: { strike: number | null; type: "PUT" | "CALL"; side: "BUY" | "SELL"; label: string }[] = [];
  if (hasPutSide) {
    legEntries.push({ strike: selectedLegs.buyPut, type: "PUT", side: "BUY", label: "protection" });
    legEntries.push({ strike: selectedLegs.sellPut, type: "PUT", side: "SELL", label: "income" });
  }
  if (hasCallSide) {
    legEntries.push({ strike: selectedLegs.sellCall, type: "CALL", side: "SELL", label: "income" });
    legEntries.push({ strike: selectedLegs.buyCall, type: "CALL", side: "BUY", label: "protection" });
  }

  // Compute display values
  const maxLoss = analysis
    ? Math.max(...[analysis.maxLossPut, analysis.maxLossCall].filter((v): v is number => v != null))
    : 0;

  // Wing width text
  const wingText = mode === "iron-condor"
    ? `${selectedLegs.sellPut! - selectedLegs.buyPut!}-point wings`
    : mode === "put-spread"
      ? `${selectedLegs.sellPut! - selectedLegs.buyPut!}-point spread`
      : `${selectedLegs.buyCall! - selectedLegs.sellCall!}-point spread`;

  // Short strikes text
  const shortStrikesText = mode === "iron-condor"
    ? `${selectedLegs.sellPut}/${selectedLegs.sellCall} iron condor`
    : mode === "put-spread"
      ? `${selectedLegs.sellPut}/${selectedLegs.buyPut} put spread`
      : `${selectedLegs.sellCall}/${selectedLegs.buyCall} call spread`;

  // Build strikes array for payoff diagram
  const diagramStrikes: Array<{ strike: number; label: string; color: string }> = [];
  if (hasPutSide) {
    diagramStrikes.push({ strike: selectedLegs.buyPut!, label: String(selectedLegs.buyPut!), color: "fill-red-500" });
    diagramStrikes.push({ strike: selectedLegs.sellPut!, label: String(selectedLegs.sellPut!), color: "fill-amber-600" });
  }
  if (hasCallSide) {
    diagramStrikes.push({ strike: selectedLegs.sellCall!, label: String(selectedLegs.sellCall!), color: "fill-amber-600" });
    diagramStrikes.push({ strike: selectedLegs.buyCall!, label: String(selectedLegs.buyCall!), color: "fill-green-500" });
  }

  return (
    <div className="space-y-4">
      {/* Recommendation summary */}
      {analysis && (
        <div className="border rounded-lg p-5 bg-blue-50 border-blue-200">
          <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Recommended {spreadModeLabel(mode)}</div>
          <p className="text-sm text-blue-900 leading-relaxed">
            Sell the <strong>{shortStrikesText}</strong> with <strong>{wingText}</strong>.
            {" "}You collect <strong className="text-green-700">${analysis.netCredit.mid.toFixed(2)}</strong> per contract
            ({quantity > 1 ? <><strong>${analysis.maxProfit.toLocaleString()}</strong> total for {quantity} contracts</> : <strong>${analysis.maxProfit.toLocaleString()}</strong>}).
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xl font-bold text-green-700">{(analysis.probabilityOfProfit * 100).toFixed(2)}%</div>
              <div className="text-xs text-blue-700">chance of profit</div>
            </div>
            <div>
              <div className="text-xl font-bold text-green-700">+${analysis.maxProfit.toLocaleString()}</div>
              <div className="text-xs text-blue-700">if {symbol} stays in range</div>
            </div>
            <div>
              <div className="text-xl font-bold text-red-600">-${maxLoss.toLocaleString()}</div>
              <div className="text-xs text-blue-700">worst case</div>
            </div>
          </div>
          <p className="text-xs text-blue-700 mt-3">
            {analysis.breakEvenLowPercent != null && (
              <>{symbol} must drop more than <strong>{analysis.breakEvenLowPercent.toFixed(1)}%</strong> </>
            )}
            {analysis.breakEvenLowPercent != null && analysis.breakEvenHighPercent != null && <>or </>}
            {analysis.breakEvenHighPercent != null && (
              <>{symbol} must rise more than <strong>{analysis.breakEvenHighPercent.toFixed(1)}%</strong> </>
            )}
            for you to lose money.
            {" "}Profit zone:{" "}
            {analysis.breakEvenLow != null && <strong>{analysis.breakEvenLow.toLocaleString()}</strong>}
            {analysis.breakEvenLow != null && analysis.breakEvenHigh != null && <> to </>}
            {analysis.breakEvenLow == null && <>below </>}
            {analysis.breakEvenHigh != null && <strong>{analysis.breakEvenHigh.toLocaleString()}</strong>}
            {analysis.breakEvenHigh == null && <> and above</>}
            .
          </p>
        </div>
      )}

      {/* Legs + Stats side by side */}
      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
          {/* Selected legs detail */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="text-xs text-muted-foreground uppercase font-medium tracking-wide mb-3">{legEntries.length} Legs of the {spreadModeLabel(mode)}</div>
            <div className="space-y-1.5">
              {legEntries.map(({ strike, type, side, label }) => {
                const option = strike ? getOptionForStrike(chain, strike, type) : null;
                const isSell = side === "SELL";
                return (
                  <div key={`${type}-${side}`} className={`flex items-center justify-between py-2 px-3 rounded ${isSell ? "bg-amber-50 font-semibold" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                        type === "PUT"
                          ? (isSell ? "bg-red-100 text-red-700" : "bg-red-50 text-red-500")
                          : (isSell ? "bg-green-100 text-green-700" : "bg-green-50 text-green-500")
                      }`}>
                        {side}
                      </span>
                      <span className="text-sm font-medium">{type} {strike ?? "\u2014"}</span>
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm tabular-nums">
                      <span className="text-muted-foreground">{"\u03B4"}{option?.delta ? (option.delta * 100).toFixed(1) : "\u2014"}</span>
                      <span className="font-medium">${option?.mid?.toFixed(2) ?? "\u2014"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t mt-3 pt-3 flex justify-between text-sm font-semibold">
              <span className="text-muted-foreground">Net Credit:</span>
              <span className="text-green-600">
                ${analysis.netCredit.mid.toFixed(2)} per contract {quantity > 1 ? `\u00D7 ${quantity} = $${analysis.maxProfit.toLocaleString()}` : ""}
              </span>
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-2 content-start">
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-xs text-muted-foreground uppercase font-medium">Max Profit</div>
              <div className="text-xl font-semibold text-green-600 tabular-nums">${analysis.maxProfit.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{symbol} stays in range</div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-xs text-muted-foreground uppercase font-medium">Max Loss</div>
              <div className="text-xl font-semibold text-red-600 tabular-nums">-${maxLoss.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">breaches a wing</div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-xs text-muted-foreground uppercase font-medium">Prob. of Profit</div>
              <div className="text-xl font-semibold text-blue-600 tabular-nums">
                {(analysis.probabilityOfProfit * 100).toFixed(2)}%
              </div>
              <div className="text-xs text-muted-foreground">implied volatility</div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-xs text-muted-foreground uppercase font-medium">Risk / Reward</div>
              <div className="text-xl font-semibold text-foreground tabular-nums">
                1 : {analysis.riskRewardRatio.toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground">per unit of risk</div>
            </div>
          </div>
        </div>
      )}

      {/* Payoff diagram - full width */}
      {analysis && (
        <div className="border rounded-lg p-4 bg-card">
          <div className="text-xs text-muted-foreground uppercase font-medium tracking-wide mb-3">P&L at Expiration</div>
          <PayoffDiagram
            payoffCurve={analysis.payoffCurve}
            underlyingPrice={underlyingPrice}
            breakEvenLow={analysis.breakEvenLow}
            breakEvenHigh={analysis.breakEvenHigh}
            breakEvenLowPercent={analysis.breakEvenLowPercent}
            breakEvenHighPercent={analysis.breakEvenHighPercent}
            maxProfit={analysis.maxProfit}
            maxLoss={maxLoss}
            strikes={diagramStrikes}
          />
        </div>
      )}

      {/* Place order button */}
      {analysis && (
        <div className="flex justify-center pt-2">
          <Button
            size="lg"
            disabled={!legsReady || !analysis}
            onClick={onPlaceOrder}
            className="h-12 px-10 text-base rounded-lg"
          >
            Place {spreadModeLabel(mode)} &mdash; Credit ${analysis.maxProfit.toLocaleString()}
          </Button>
        </div>
      )}
    </div>
  );
}
