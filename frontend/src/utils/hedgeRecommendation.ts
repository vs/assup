/**
 * Pure hedge recommendation engine.
 * Evaluates GEX levels + spread risk status to produce actionable recommendations.
 * No React dependencies — testable as a standalone function.
 */

import type { ActiveSpread, MacroGexLevels, MarketRegime } from "@assup/shared";
import type { SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";

export type HedgeAction =
  | "hold"
  | "add-call-spread"
  | "roll-down"
  | "close-early"
  | "butterfly"
  | "protective"
  | "do-not-trade";

export interface HedgeRecommendation {
  action: HedgeAction;
  urgency: "info" | "warning" | "critical";
  reason: string;
  details?: string;
}

interface RecommendationInput {
  spread: ActiveSpread;
  riskStatus: SpreadRiskStatus;
  spxPrice: number | null;
  gexLevels: MacroGexLevels | null;
  vix: number | null;
  regime: MarketRegime;
}

/** Threshold: "approaching" GEX flip = within 0.5% of spot */
const GEX_APPROACH_PCT = 0.005;

/** Only apply GEX-based rules when short strike is within this % of SPX */
const STRIKE_RELEVANCE_PCT = 0.05;

/** VIX threshold for tail-risk regime */
const VIX_TAIL_RISK = 30;

/**
 * Get the short leg strike from a spread.
 * Put spread: short leg is the higher strike put.
 * Call spread: short leg is the lower strike call.
 */
function getShortLegStrike(spread: ActiveSpread): number | null {
  const shortLeg = spread.legs.find((l) => l.side === "SELL");
  return shortLeg?.strike ?? null;
}

/**
 * Determine if price is "approaching" a level (within GEX_APPROACH_PCT).
 */
function isApproaching(price: number, level: number): boolean {
  return Math.abs(price - level) / price <= GEX_APPROACH_PCT;
}

/**
 * Produce a hedge recommendation for a single spread.
 */
export function recommendHedge(input: RecommendationInput): HedgeRecommendation {
  const { spread, riskStatus, spxPrice, gexLevels, vix, regime } = input;

  // Only recommend for vertical spreads (not iron condors — they need per-side logic)
  if (spread.type === "iron-condor") {
    return { action: "hold", urgency: "info", reason: "Iron condor — manage sides individually" };
  }

  const isPut = spread.type === "put-spread";
  const shortStrike = getShortLegStrike(spread);

  // If we can't determine the short strike, can't recommend
  if (shortStrike == null) {
    return { action: "hold", urgency: "info", reason: "" };
  }

  // --- Fallback: no GEX or no SPX price — use risk level only ---
  if (spxPrice == null || gexLevels == null) {
    if (riskStatus.level === "danger") {
      return {
        action: "close-early",
        urgency: "warning",
        reason: "Spread at danger level — consider closing",
        details: "GEX data unavailable. Recommendation based on premium multiple only.",
      };
    }
    return { action: "hold", urgency: "info", reason: "" };
  }

  const gexFlip = gexLevels.gexFlip;

  // --- Rule 1: Tail risk (VIX spike or risk_off regime + danger) ---
  if ((vix != null && vix >= VIX_TAIL_RISK) || regime === "risk_off") {
    if (riskStatus.level === "danger") {
      return {
        action: "protective",
        urgency: "critical",
        reason: `Tail risk — VIX ${vix != null ? vix.toFixed(1) : "N/A"}, regime ${regime}`,
        details: "Consider buying protective option or closing immediately. High volatility environment.",
      };
    }
    if (riskStatus.level === "warning") {
      return {
        action: "close-early",
        urgency: "warning",
        reason: `Elevated risk — VIX ${vix != null ? vix.toFixed(1) : "N/A"}, regime ${regime}`,
        details: "Market conditions unfavorable. Consider closing to limit exposure.",
      };
    }
  }

  // --- Rules 2-5 require GEX flip ---
  if (gexFlip == null) {
    // No flip level — fall back to risk-only
    if (riskStatus.level === "danger") {
      return {
        action: "close-early",
        urgency: "warning",
        reason: "Spread at danger level — consider closing",
        details: "GEX flip level unavailable.",
      };
    }
    return { action: "hold", urgency: "info", reason: "" };
  }

  // Only apply GEX flip rules when the short strike is close enough to SPX
  // to be actionable. A GEX flip breach 1000+ points from the short strike is noise.
  const strikeDistancePct = Math.abs(shortStrike - spxPrice) / spxPrice;
  const strikeRelevant = strikeDistancePct <= STRIKE_RELEVANCE_PCT;

  // Direction logic: for put spreads, danger is price dropping below flip.
  // For call spreads, danger is price rising above flip.
  const priceBreachedFlip = isPut
    ? spxPrice < gexFlip
    : spxPrice > gexFlip;

  const priceApproachingFlip = isPut
    ? !priceBreachedFlip && isApproaching(spxPrice, gexFlip) && spxPrice > gexFlip
    : !priceBreachedFlip && isApproaching(spxPrice, gexFlip) && spxPrice < gexFlip;

  const flipLabel = gexFlip.toFixed(0);

  // --- Rule 2: Price below/above GEX flip (breached) ---
  if (priceBreachedFlip && strikeRelevant) {
    if (riskStatus.level === "danger") {
      return {
        action: "butterfly",
        urgency: "critical",
        reason: `SPX ${isPut ? "below" : "above"} GEX flip (${flipLabel}) — consider butterfly conversion`,
        details: "Price in amplified-move zone. Butterfly caps loss and profits if move continues.",
      };
    }
    return {
      action: "close-early",
      urgency: "warning",
      reason: `SPX crossed GEX flip (${flipLabel}) — consider closing`,
      details: "Price in amplified-move zone. Moves may accelerate without dealer hedging support.",
    };
  }

  // --- Rule 3: Price approaching GEX flip ---
  if (priceApproachingFlip && strikeRelevant) {
    return {
      action: "roll-down",
      urgency: "info",
      reason: `SPX nearing GEX flip (${flipLabel}) — watch for roll or close`,
      details: `Price is within ${(GEX_APPROACH_PCT * 100).toFixed(1)}% of the GEX flip level. Rolling moves your short strike further away.`,
    };
  }

  // --- Rule 4: Above flip, warning level — suggest adding credit ---
  if (riskStatus.level === "warning") {
    const putWallIntact = isPut && gexLevels.putWall > 0 && spxPrice > gexLevels.putWall;
    const callWallIntact = !isPut && gexLevels.callWall > 0 && spxPrice < gexLevels.callWall;

    if (putWallIntact || callWallIntact) {
      return {
        action: "add-call-spread",
        urgency: "info",
        reason: `${isPut ? "Put wall" : "Call wall"} intact — consider adding ${isPut ? "call" : "put"} spread for extra credit`,
        details: "Price is above key support/resistance. Adding the opposite side converts to iron condor for additional credit cushion.",
      };
    }
  }

  // --- Rule 5: Healthy — hold ---
  return { action: "hold", urgency: "info", reason: "" };
}
