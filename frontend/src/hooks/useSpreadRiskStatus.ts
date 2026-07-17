// frontend/src/hooks/useSpreadRiskStatus.ts
import { useMemo } from "react";
import type { ActiveSpread } from "@assup/shared";

export type RiskLevel = "healthy" | "warning" | "danger";

export interface SpreadRiskStatus {
  level: RiskLevel;
  premiumMultiple: number | null;
}

/**
 * Compute risk status for a spread based on unrealized P&L vs net premium.
 * warningPct/dangerPct are stored as percentages (e.g., 100 = 1× premium).
 */
export function computeRiskStatus(
  totalPnl: number | null,
  netPremium: number,
  warningPct: number,
  dangerPct: number,
): SpreadRiskStatus {
  if (totalPnl == null || totalPnl >= 0 || netPremium === 0) {
    return { level: "healthy", premiumMultiple: null };
  }
  const multiple = Math.abs(totalPnl) / Math.abs(netPremium);
  if (multiple >= dangerPct / 100) return { level: "danger", premiumMultiple: multiple };
  if (multiple >= warningPct / 100) return { level: "warning", premiumMultiple: multiple };
  return { level: "healthy", premiumMultiple: multiple };
}

export function useSpreadRiskStatus(
  spreads: ActiveSpread[],
  warningPct: number,
  dangerPct: number,
): Map<string, SpreadRiskStatus> {
  return useMemo(() => {
    const map = new Map<string, SpreadRiskStatus>();
    for (const s of spreads) {
      map.set(s.id, computeRiskStatus(s.totalPnl, s.netPremium, warningPct, dangerPct));
    }
    return map;
  }, [spreads, warningPct, dangerPct]);
}
