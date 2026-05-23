/**
 * Right panel: selected legs summary, stats cards, payoff diagram, metrics, order button.
 */

import { Button } from "@/components/ui/button";
import { PayoffDiagram } from "./PayoffDiagram";
import type { IronCondorAnalyzeResponse, IronCondorChainStrike, IronCondorSelectedLegs } from "@assup/shared";

interface IronCondorAnalysisProps {
  analysis: IronCondorAnalyzeResponse | null;
  selectedLegs: IronCondorSelectedLegs;
  chain: IronCondorChainStrike[];
  underlyingPrice: number;
  quantity: number;
  loading: boolean;
  onPlaceOrder: () => void;
}

function getOptionForStrike(chain: IronCondorChainStrike[], strike: number, type: "PUT" | "CALL") {
  const entry = chain.find(c => c.strike === strike);
  return type === "PUT" ? entry?.put : entry?.call;
}

export function IronCondorAnalysis({
  analysis,
  selectedLegs,
  chain,
  underlyingPrice,
  quantity,
  loading,
  onPlaceOrder,
}: IronCondorAnalysisProps) {
  const allLegsSelected = selectedLegs.buyPut && selectedLegs.sellPut && selectedLegs.sellCall && selectedLegs.buyCall;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Analysis</h3>

      {/* Selected legs summary */}
      <div className="border rounded-lg p-3 bg-card">
        <div className="text-[10px] text-muted-foreground uppercase font-medium mb-2">Selected Legs</div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-1 text-xs">
          {([
            { strike: selectedLegs.buyPut, type: "PUT" as const, side: "BUY" },
            { strike: selectedLegs.sellPut, type: "PUT" as const, side: "SELL" },
            { strike: selectedLegs.sellCall, type: "CALL" as const, side: "SELL" },
            { strike: selectedLegs.buyCall, type: "CALL" as const, side: "BUY" },
          ]).map(({ strike, type, side }) => {
            const option = strike ? getOptionForStrike(chain, strike, type) : null;
            const color = type === "PUT" ? "text-red-600" : "text-green-600";
            return (
              <div key={`${type}-${side}`} className="contents">
                <div className={`${color} ${side === "SELL" ? "font-semibold" : ""}`}>{side}</div>
                <div className={side === "SELL" ? "font-semibold" : ""}>{type} {strike ?? "\u2014"}</div>
                <div className="text-muted-foreground">{"\u03B4"} {option?.delta?.toFixed(1) ?? "\u2014"}</div>
                <div>${option?.mid?.toFixed(2) ?? "\u2014"}</div>
              </div>
            );
          })}
        </div>
        {analysis && (
          <div className="border-t mt-2 pt-2 flex justify-between text-xs">
            <span className="text-muted-foreground">Net Credit (mid):</span>
            <span className="text-green-600 font-semibold">
              ${analysis.netCredit.mid.toFixed(2)} {"\u00D7"} {quantity} = ${analysis.maxProfit.toLocaleString()}
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
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Max Loss</div>
              <div className="text-xl font-semibold text-red-600">
                -${Math.max(analysis.maxLossPut, analysis.maxLossCall).toLocaleString()}
              </div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Prob. of Profit</div>
              <div className="text-xl font-semibold text-blue-600">
                {(analysis.probabilityOfProfit * 100).toFixed(1)}%
              </div>
            </div>
            <div className="border rounded-lg p-3 text-center bg-card">
              <div className="text-[10px] text-muted-foreground uppercase font-medium">Expected Value</div>
              <div className={`text-xl font-semibold ${analysis.expectedValue >= 0 ? "text-amber-600" : "text-red-600"}`}>
                ${analysis.expectedValue.toLocaleString()}
              </div>
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
              maxLoss={Math.max(analysis.maxLossPut, analysis.maxLossCall)}
              strikes={{
                buyPut: selectedLegs.buyPut!,
                sellPut: selectedLegs.sellPut!,
                sellCall: selectedLegs.sellCall!,
                buyCall: selectedLegs.buyCall!,
              }}
            />
          </div>

          {/* Additional metrics */}
          <div className="border rounded-lg p-3 bg-card">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Breakeven Low:</span> <span className="font-medium">{analysis.breakEvenLow.toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">Breakeven High:</span> <span className="font-medium">{analysis.breakEvenHigh.toLocaleString()}</span></div>
              <div><span className="text-muted-foreground">Risk/Reward:</span> <span className="font-medium">1 : {analysis.riskRewardRatio.toFixed(1)}</span></div>
              <div><span className="text-muted-foreground">Profit Range:</span> <span className="font-medium">{(analysis.breakEvenHigh - analysis.breakEvenLow).toFixed(0)} pts</span></div>
              <div><span className="text-muted-foreground">P(Max Loss Put):</span> <span className="text-red-600 font-medium">{(analysis.probabilityOfMaxLossPut * 100).toFixed(1)}%</span></div>
              <div><span className="text-muted-foreground">P(Max Loss Call):</span> <span className="text-red-600 font-medium">{(analysis.probabilityOfMaxLossCall * 100).toFixed(1)}%</span></div>
            </div>
          </div>
        </>
      )}

      {/* Place order button */}
      <Button
        className="w-full"
        size="lg"
        disabled={!allLegsSelected || !analysis || loading}
        onClick={onPlaceOrder}
      >
        {analysis
          ? `Place Iron Condor \u2014 Credit $${analysis.maxProfit.toLocaleString()}`
          : "Select all 4 legs"
        }
      </Button>
    </div>
  );
}
