/**
 * GEX-informed spread strike recommendation.
 * Adjusts delta-based strike picks to respect dealer positioning levels.
 */

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  GexAnalysisResponse,
  GexKeyLevels,
  IronCondorChainStrike,
  SpreadMode,
  SpreadSelectedLegs,
} from "@assup/shared";

interface GexSpreadRecommendationProps {
  gexData: GexAnalysisResponse;
  chain: IronCondorChainStrike[];
  mode: SpreadMode;
  putDelta: number;
  callDelta: number;
  wingWidth: number;
  onApply: (legs: SpreadSelectedLegs) => void;
}

// --- Algorithm ---

interface RecommendedLeg {
  type: "PUT" | "CALL";
  side: "BUY" | "SELL";
  strike: number;
  delta: number | null;
  rationale: string;
  gexOverride: boolean;
  /** Original delta-based strike before GEX override, shown when overridden */
  originalStrike?: number;
}

interface GexRecommendation {
  legs: RecommendedLeg[];
  warnings: string[];
}

function findClosestDelta(
  chain: IronCondorChainStrike[],
  targetDelta: number,
  type: "PUT" | "CALL",
): { strike: number; delta: number } | null {
  let best: { strike: number; delta: number } | null = null;
  let bestDiff = Infinity;
  for (const entry of chain) {
    const option = type === "PUT" ? entry.put : entry.call;
    if (!option || option.delta === 0) continue;
    const diff = Math.abs(option.delta * 100 - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { strike: entry.strike, delta: option.delta };
    }
  }
  return best;
}

function snapToChain(chain: IronCondorChainStrike[], target: number): number {
  return chain.reduce(
    (closest, entry) =>
      Math.abs(entry.strike - target) < Math.abs(closest - target)
        ? entry.strike
        : closest,
    chain[0]?.strike ?? target,
  );
}

function nearestChainAtOrAbove(chain: IronCondorChainStrike[], target: number): number | null {
  let best: number | null = null;
  for (const entry of chain) {
    if (entry.strike >= target) {
      if (best === null || entry.strike < best) best = entry.strike;
    }
  }
  return best;
}

function nearestChainAtOrBelow(chain: IronCondorChainStrike[], target: number): number | null {
  let best: number | null = null;
  for (const entry of chain) {
    if (entry.strike <= target) {
      if (best === null || entry.strike > best) best = entry.strike;
    }
  }
  return best;
}

function getDelta(chain: IronCondorChainStrike[], strike: number, type: "PUT" | "CALL"): number | null {
  const entry = chain.find((e) => e.strike === strike);
  const option = type === "PUT" ? entry?.put : entry?.call;
  return option?.delta ?? null;
}

function formatPct(spot: number, strike: number): string {
  return ((Math.abs(spot - strike) / spot) * 100).toFixed(1);
}

export function recommendGexStrikes(params: {
  chain: IronCondorChainStrike[];
  gexLevels: GexKeyLevels;
  spot: number;
  mode: SpreadMode;
  putDelta: number;
  callDelta: number;
  wingWidth: number;
}): GexRecommendation {
  const { chain, gexLevels, spot, mode, putDelta, callDelta, wingWidth } = params;
  const legs: RecommendedLeg[] = [];
  const warnings: string[] = [];

  const hasPutSide = mode === "put-spread" || mode === "iron-condor";
  const hasCallSide = mode === "call-spread" || mode === "iron-condor";

  const putWallValid = gexLevels.putWall.oi > 0 && gexLevels.putWall.strike < spot;
  const callWallValid = gexLevels.callWall.oi > 0 && gexLevels.callWall.strike > spot;

  if (hasPutSide) {
    const baseline = findClosestDelta(chain, putDelta, "PUT");
    if (baseline) {
      let shortPut = baseline.strike;
      let overridden = false;
      let rationale = `${putDelta}\u0394 target`;
      let originalStrike: number | undefined;

      // Override: if short put is below the put wall, move it up
      if (putWallValid && shortPut < gexLevels.putWall.strike) {
        originalStrike = shortPut;
        const moved = nearestChainAtOrAbove(chain, gexLevels.putWall.strike);
        if (moved !== null) {
          shortPut = moved;
          overridden = true;
          rationale = `Moved from ${originalStrike} to stay above put wall (${gexLevels.putWall.strike}) \u2014 dealer support cushion`;
        }
      }

      // Warning: short put near or below GEX flip
      if (gexLevels.gexFlip != null && shortPut <= gexLevels.gexFlip) {
        warnings.push(
          `Short put ${shortPut} is below GEX flip (${gexLevels.gexFlip.toFixed(0)}) \u2014 in amplified-move zone`,
        );
      } else if (
        gexLevels.gexFlip != null &&
        shortPut > gexLevels.gexFlip &&
        (shortPut - gexLevels.gexFlip) / spot < 0.005
      ) {
        warnings.push(
          `Short put ${shortPut} is only ${formatPct(spot, gexLevels.gexFlip)}% above GEX flip (${gexLevels.gexFlip.toFixed(0)}) \u2014 close to amplified-move zone`,
        );
      }

      legs.push({
        type: "PUT",
        side: "SELL",
        strike: shortPut,
        delta: getDelta(chain, shortPut, "PUT"),
        rationale,
        gexOverride: overridden,
        originalStrike,
      });

      // Long put: wing below short put
      const buyPutTarget = shortPut - wingWidth;
      const buyPut = snapToChain(chain, buyPutTarget);
      legs.push({
        type: "PUT",
        side: "BUY",
        strike: buyPut,
        delta: getDelta(chain, buyPut, "PUT"),
        rationale: `Wing: ${Math.abs(shortPut - buyPut)}pts below short`,
        gexOverride: false,
      });
    }
  }

  if (hasCallSide) {
    const baseline = findClosestDelta(chain, callDelta, "CALL");
    if (baseline) {
      let shortCall = baseline.strike;
      let overridden = false;
      let rationale = `${callDelta}\u0394 target`;
      let originalStrike: number | undefined;

      // Override: if short call is above the call wall, move it down
      if (callWallValid && shortCall > gexLevels.callWall.strike) {
        originalStrike = shortCall;
        const moved = nearestChainAtOrBelow(chain, gexLevels.callWall.strike);
        if (moved !== null) {
          shortCall = moved;
          overridden = true;
          rationale = `Moved from ${originalStrike} to stay below call wall (${gexLevels.callWall.strike}) \u2014 dealer resistance cap`;
        }
      }

      legs.push({
        type: "CALL",
        side: "SELL",
        strike: shortCall,
        delta: getDelta(chain, shortCall, "CALL"),
        rationale,
        gexOverride: overridden,
        originalStrike,
      });

      // Long call: wing above short call
      const buyCallTarget = shortCall + wingWidth;
      const buyCall = snapToChain(chain, buyCallTarget);
      legs.push({
        type: "CALL",
        side: "BUY",
        strike: buyCall,
        delta: getDelta(chain, buyCall, "CALL"),
        rationale: `Wing: ${Math.abs(buyCall - shortCall)}pts above short`,
        gexOverride: false,
      });
    }
  }

  return { legs, warnings };
}

// --- UI Component ---

export function GexSpreadRecommendation({
  gexData,
  chain,
  mode,
  putDelta,
  callDelta,
  wingWidth,
  onApply,
}: GexSpreadRecommendationProps) {
  const recommendation = useMemo(
    () =>
      chain.length > 0
        ? recommendGexStrikes({
            chain,
            gexLevels: gexData.levels,
            spot: gexData.spot,
            mode,
            putDelta,
            callDelta,
            wingWidth,
          })
        : null,
    [chain, gexData.levels, gexData.spot, mode, putDelta, callDelta, wingWidth],
  );

  if (!recommendation || recommendation.legs.length === 0) {
    return (
      <div className="border rounded-lg p-4 text-sm text-muted-foreground">
        Insufficient data for strike recommendation — waiting for chain data.
      </div>
    );
  }

  const hasPutSide = mode === "put-spread" || mode === "iron-condor";
  const hasCallSide = mode === "call-spread" || mode === "iron-condor";

  const deltaLabel = [
    hasPutSide ? `${putDelta}\u0394 put` : null,
    hasCallSide ? `${callDelta}\u0394 call` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  const handleApply = () => {
    const applied: SpreadSelectedLegs = {
      sellPut: null,
      buyPut: null,
      sellCall: null,
      buyCall: null,
    };
    for (const leg of recommendation.legs) {
      if (leg.type === "PUT" && leg.side === "SELL") applied.sellPut = leg.strike;
      if (leg.type === "PUT" && leg.side === "BUY") applied.buyPut = leg.strike;
      if (leg.type === "CALL" && leg.side === "SELL") applied.sellCall = leg.strike;
      if (leg.type === "CALL" && leg.side === "BUY") applied.buyCall = leg.strike;
    }
    onApply(applied);
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="text-sm font-medium">Recommended Spread</div>
      <p className="text-xs text-muted-foreground">
        Based on your {deltaLabel} target and {wingWidth}pt wings, adjusted for GEX dealer positioning:
      </p>

      <div className="space-y-1.5">
        {recommendation.legs.map((leg) => {
          const isSell = leg.side === "SELL";
          return (
            <div
              key={`${leg.type}-${leg.side}`}
              className={`flex items-center gap-3 py-1.5 px-2 rounded text-sm ${isSell ? "bg-amber-50" : ""}`}
            >
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  leg.type === "PUT"
                    ? isSell
                      ? "bg-red-100 text-red-700"
                      : "bg-red-50 text-red-500"
                    : isSell
                      ? "bg-green-100 text-green-700"
                      : "bg-green-50 text-green-500"
                }`}
              >
                {leg.side}
              </span>
              <span className={`font-medium tabular-nums ${isSell ? "font-semibold" : "text-muted-foreground"}`}>
                {leg.type} {leg.strike}
              </span>
              {leg.delta != null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {"\u03B4"}{(leg.delta * 100).toFixed(1)}
                </span>
              )}
              <span className="text-xs text-muted-foreground flex-1">
                {leg.gexOverride && "\u25B2 "}
                {leg.rationale}
              </span>
            </div>
          );
        })}
      </div>

      {recommendation.warnings.length > 0 && (
        <Alert className="bg-yellow-500/10 border-yellow-500/30">
          <AlertDescription className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
            {recommendation.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={handleApply}>
          Apply to Spread Builder
        </Button>
      </div>
    </div>
  );
}
