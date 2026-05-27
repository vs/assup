/**
 * Right panel: recommendation summary, selected legs, stats cards, payoff diagram, metrics, order button.
 */

import { Button } from "@/components/ui/button";
import { PayoffDiagram } from "./PayoffDiagram";
import type { IronCondorAnalyzeResponse, IronCondorChainStrike, SpreadSelectedLegs, SpreadMode } from "@assup/shared";

interface SpreadAnalysisProps {
  analysis: IronCondorAnalyzeResponse | null;
  selectedLegs: SpreadSelectedLegs;
  chain: IronCondorChainStrike[];
  underlyingPrice: number;
  quantity: number;
  loading: boolean;
  onPlaceOrder: () => void;
  mode: SpreadMode;
  symbol: string;
}

function getOptionForStrike(chain: IronCondorChainStrike[], strike: number, type: "PUT" | "CALL") {
  const entry = chain.find(c => c.strike === strike);
  return type === "PUT" ? entry?.put : entry?.call;
}

function spreadModeLabel(mode: SpreadMode): string {
  switch (mode) {
    case "put-spread": return "Put Spread";
    case "call-spread": return "Call Spread";
    case "iron-condor": return "Iron Condor";
  }
}

export function SpreadAnalysis({
  analysis,
  selectedLegs,
  chain,
  underlyingPrice,
  quantity,
  loading,
  onPlaceOrder,
  mode,
  symbol,
}: SpreadAnalysisProps) {
  const hasPutSide = mode === "put-spread" || mode === "iron-condor";
  const hasCallSide = mode === "call-spread" || mode === "iron-condor";

  const legsReady = (hasPutSide ? selectedLegs.buyPut && selectedLegs.sellPut : true)
    && (hasCallSide ? selectedLegs.sellCall && selectedLegs.buyCall : true);

  if (!legsReady) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Adjust parameters above to generate a recommendation, or click strikes in the chain to build manually.
      </div>
    );
  }

  // Build leg list for display
  const legEntries: { strike: number | null; type: "PUT" | "CALL"; side: "BUY" | "SELL"; label: string }[] = [];
  if (hasPutSide) {
    legEntries.push({ strike: selectedLegs.buyPut, type: "PUT", side: "BUY", label: "Buy Put (protection)" });
    legEntries.push({ strike: selectedLegs.sellPut, type: "PUT", side: "SELL", label: "Sell Put (income)" });
  }
  if (hasCallSide) {
    legEntries.push({ strike: selectedLegs.sellCall, type: "CALL", side: "SELL", label: "Sell Call (income)" });
    legEntries.push({ strike: selectedLegs.buyCall, type: "CALL", side: "BUY", label: "Buy Call (protection)" });
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
        <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
          <div className="text-xs font-semibold text-blue-700 uppercase mb-2">Recommended {spreadModeLabel(mode)}</div>
          <p className="text-sm text-blue-900 leading-relaxed">
            Sell the <strong>{shortStrikesText}</strong> with <strong>{wingText}</strong>.
            {" "}You collect <strong className="text-green-700">${analysis.netCredit.mid.toFixed(2)}</strong> per contract
            ({quantity > 1 ? <><strong>${analysis.maxProfit.toLocaleString()}</strong> total for {quantity} contracts</> : <strong>${analysis.maxProfit.toLocaleString()}</strong>}).
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-green-700">{(analysis.probabilityOfProfit * 100).toFixed(0)}%</div>
              <div className="text-[10px] text-blue-700">chance of profit</div>
            </div>
            <div>
              <div className="text-lg font-bold text-green-700">+${analysis.maxProfit.toLocaleString()}</div>
              <div className="text-[10px] text-blue-700">if {symbol} stays in range</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-600">-${maxLoss.toLocaleString()}</div>
              <div className="text-[10px] text-blue-700">worst case</div>
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

      {/* Selected legs detail */}
      <div className="border rounded-lg p-3 bg-card">
        <div className="text-[10px] text-muted-foreground uppercase font-medium mb-2">{legEntries.length} Legs of the {spreadModeLabel(mode)}</div>
        <div className="space-y-1 text-xs">
          {legEntries.map(({ strike, type, side, label }) => {
            const option = strike ? getOptionForStrike(chain, strike, type) : null;
            const isSell = side === "SELL";
            return (
              <div key={`${type}-${side}`} className={`flex items-center justify-between py-1 px-2 rounded ${isSell ? "bg-amber-50 font-semibold" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                    type === "PUT"
                      ? (isSell ? "bg-red-100 text-red-700" : "bg-red-50 text-red-500")
                      : (isSell ? "bg-green-100 text-green-700" : "bg-green-50 text-green-500")
                  }`}>
                    {side}
                  </span>
                  <span>{type} {strike ?? "\u2014"}</span>
                  <span className="text-muted-foreground font-normal">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{"\u03B4"}{option?.delta ? (option.delta * 100).toFixed(1) : "\u2014"}</span>
                  <span>${option?.mid?.toFixed(2) ?? "\u2014"}</span>
                </div>
              </div>
            );
          })}
        </div>
        {analysis && (
          <div className="border-t mt-2 pt-2 flex justify-between text-xs font-semibold">
            <span className="text-muted-foreground">Net Credit:</span>
            <span className="text-green-600">
              ${analysis.netCredit.mid.toFixed(2)} per contract {quantity > 1 ? `\u00D7 ${quantity} = $${analysis.maxProfit.toLocaleString()}` : ""}
            </span>
          </div>
        )}
      </div>

      {/* Stats cards */}
      {analysis && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Max Profit</div>
              <div className="text-xl font-semibold text-green-600">${analysis.maxProfit.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">if {symbol} stays between strikes</div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Max Loss</div>
              <div className="text-xl font-semibold text-red-600">-${maxLoss.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">if {symbol} breaches a wing</div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Prob. of Profit</div>
              <div className="text-xl font-semibold text-blue-600">
                {(analysis.probabilityOfProfit * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground">based on implied volatility</div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Risk / Reward</div>
              <div className="text-xl font-semibold text-foreground">
                1 : {analysis.riskRewardRatio.toFixed(1)}
              </div>
              <div className="text-[10px] text-muted-foreground">reward per unit of risk</div>
            </div>
          </div>

          {/* Payoff diagram */}
          <div className="border rounded-lg p-3 bg-card">
            <div className="text-[10px] text-muted-foreground uppercase font-medium mb-2">P&L at Expiration</div>
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

          {/* Detailed metrics */}
          <div className="border rounded-lg p-3 bg-card">
            <div className="text-[10px] text-muted-foreground uppercase font-medium mb-2">Detailed Metrics</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {analysis.breakEvenLow != null && (
                <div><span className="text-muted-foreground">Breakeven Low:</span> <span className="font-medium">{analysis.breakEvenLow.toLocaleString()}</span> <span className="text-muted-foreground">({analysis.breakEvenLowPercent!.toFixed(1)}% down)</span></div>
              )}
              {analysis.breakEvenHigh != null && (
                <div><span className="text-muted-foreground">Breakeven High:</span> <span className="font-medium">{analysis.breakEvenHigh.toLocaleString()}</span> <span className="text-muted-foreground">({analysis.breakEvenHighPercent!.toFixed(1)}% up)</span></div>
              )}
              {analysis.breakEvenLow != null && analysis.breakEvenHigh != null && (
                <div><span className="text-muted-foreground">Profit Range:</span> <span className="font-medium">{(analysis.breakEvenHigh - analysis.breakEvenLow).toFixed(0)} pts</span></div>
              )}
              <div><span className="text-muted-foreground">Expected Value:</span> <span className={`font-medium ${analysis.expectedValue >= 0 ? "text-green-600" : "text-red-600"}`}>${analysis.expectedValue.toLocaleString()}</span></div>
              {analysis.probabilityOfMaxLossPut != null && (
                <div><span className="text-muted-foreground">P(Max Loss Put):</span> <span className="text-red-600 font-medium">{(analysis.probabilityOfMaxLossPut * 100).toFixed(1)}%</span></div>
              )}
              {analysis.probabilityOfMaxLossCall != null && (
                <div><span className="text-muted-foreground">P(Max Loss Call):</span> <span className="text-red-600 font-medium">{(analysis.probabilityOfMaxLossCall * 100).toFixed(1)}%</span></div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Place order button */}
      <Button
        className="w-full"
        size="lg"
        disabled={!legsReady || !analysis || loading}
        onClick={onPlaceOrder}
      >
        {analysis
          ? `Place ${spreadModeLabel(mode)} \u2014 Credit $${analysis.maxProfit.toLocaleString()}`
          : "Loading analysis..."
        }
      </Button>
    </div>
  );
}
