/**
 * React hook that produces hedge recommendations for active spreads.
 * Consumes macro data (SPX price, GEX levels, VIX, regime) via useMacro()
 * and evaluates each spread against the decision matrix.
 */

import { useMemo } from "react";
import { useMacro } from "@/components/common/MacroProvider";
import { recommendHedge, type HedgeRecommendation } from "@/utils/hedgeRecommendation";
import type { ActiveSpread } from "@assup/shared";
import type { SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";

export function useHedgeRecommendations(
  spreads: ActiveSpread[],
  riskMap: Map<string, SpreadRiskStatus>,
): Map<string, HedgeRecommendation> {
  const { macro } = useMacro();

  return useMemo(() => {
    const map = new Map<string, HedgeRecommendation>();
    if (!macro) return map;

    const spxPrice = macro.details.sp500Index ?? null;
    const gexLevels = macro.details.gexLevels ?? null;
    const vix = macro.details.vix ?? null;
    const regime = macro.regime;

    for (const spread of spreads) {
      const riskStatus = riskMap.get(spread.id) ?? { level: "healthy" as const, premiumMultiple: null };
      const rec = recommendHedge({ spread, riskStatus, spxPrice, gexLevels, vix, regime });
      map.set(spread.id, rec);
    }

    return map;
  }, [spreads, riskMap, macro]);
}
