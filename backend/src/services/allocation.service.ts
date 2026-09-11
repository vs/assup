/**
 * Service for calculating portfolio allocations
 */

import { prisma } from "../db/index.js";
import { assignmentService, AssignmentMap, getSecurityKey } from "./assignment.service.js";
import { ibkrService, Position as IBPosition } from "./ibkr.js";
import { isIgnorablePositionError } from "../utils/index.js";
import {
  getOptionsNotionalSign,
  type AssetClassAllocation,
  type OptionsExposure,
  type OptionsWeightMode,
  type Position,
} from "@assup/shared";

/**
 * Asset class value accumulator used during allocation calculations
 */
interface AssetClassAccumulator {
  name: string;
  color: string;
  stockValue: number;
  optionsNotional: number;
  optionsDelta: number;
  value: number;
  percentage: number;
}

/**
 * Result of allocation calculation
 */
export interface AllocationResult {
  byAssetClass: AssetClassAllocation[];
  optionsExposure: OptionsExposure[];
  totalValue: number;
  totalStockValue: number;
  totalOptionsNotional: number;
  totalOptionsDelta: number;
  totalPutNotional: number;
  totalShortPutNotional: number;
  totalLongPutNotional: number;
  totalCallNotional: number;
  totalShortCallNotional: number;
  totalLongCallNotional: number;
  totalPutDelta: number;
  totalCallDelta: number;
  unassignedValue: number;
  unassignedPercentage: number;
}

/**
 * Simple position data for allocation calculations
 */
export interface PositionForAllocation {
  symbol: string;
  secType: string;
  position: number;
  avgCost: number;
  marketValue?: number | null;
  notionalValue?: number;
  deltaExposure?: number;
  right?: "P" | "C";
  underlying?: string;
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
}

class AllocationService {
  /**
   * Calculate current allocation by asset class for a set of positions
   */
  async calculateAllocation(
    positions: PositionForAllocation[],
    options: {
      includeOptions: boolean;
      optionsWeightMode: OptionsWeightMode;
      cashValue?: number;
    }
  ): Promise<AllocationResult> {
    const { includeOptions, optionsWeightMode, cashValue = 0 } = options;

    // Get Cash asset class
    const cashAssetClass = await prisma.assetClass.findFirst({
      where: { name: "Cash" },
    });

    const byAssetClass: Record<string, AssetClassAccumulator> = {};
    let unassignedValue = 0;
    let totalStockValue = 0;
    let totalOptionsNotional = 0;
    let totalOptionsDelta = 0;
    let totalPutNotional = 0;
    let totalShortPutNotional = 0;
    let totalLongPutNotional = 0;
    let totalCallNotional = 0;
    let totalShortCallNotional = 0;
    let totalLongCallNotional = 0;
    let totalPutDelta = 0;
    let totalCallDelta = 0;

    // First pass: stocks (skip options and cash)
    for (const pos of positions) {
      if (pos.secType === "OPT" || pos.secType === "CASH") continue;

      const value = pos.marketValue ?? Math.abs(pos.position * pos.avgCost);
      totalStockValue += value;

      if (pos.assetClassId && pos.assetClassName) {
        if (!byAssetClass[pos.assetClassId]) {
          byAssetClass[pos.assetClassId] = this.createAccumulator(
            pos.assetClassName,
            pos.assetClassColor || "#6366f1"
          );
        }
        byAssetClass[pos.assetClassId].stockValue += value;
      } else {
        unassignedValue += value;
      }
    }

    // Second pass: options exposure
    // Exclude spread-eligible underlyings (SPX, XSP, RUT) — those are temporary
    // income trades (credit spreads, iron condors), not portfolio allocation positions.
    const spreadSymbolsSetting = await prisma.setting.findUnique({ where: { key: "spreads" } });
    const spreadSymbols = new Set<string>(
      (spreadSymbolsSetting?.value as any)?.symbols ?? ["SPX", "XSP", "RUT"]
    );

    const optionsExposure: OptionsExposure[] = [];

    for (const pos of positions) {
      if (pos.secType !== "OPT") continue;
      if (pos.underlying && spreadSymbols.has(pos.underlying)) continue;

      const notional = pos.notionalValue || 0;
      const delta = pos.deltaExposure || 0;
      const isPut = pos.right === "P";
      const isShort = pos.position < 0;

      // Track totals by option type (using absolute values for exposure)
      if (isPut) {
        totalPutNotional += Math.abs(notional);
        totalPutDelta += Math.abs(delta);
        // Split put notional by direction: sold (short) vs bought (long).
        // Short puts = obligation to buy; long puts = right to sell/hedge.
        if (isShort) {
          totalShortPutNotional += Math.abs(notional);
        } else {
          totalLongPutNotional += Math.abs(notional);
        }
      } else {
        totalCallNotional += Math.abs(notional);
        totalCallDelta += Math.abs(delta);
        // Split call notional by direction: sold (short) vs bought (long).
        // Short calls = obligation to sell; long calls = right to buy.
        if (isShort) {
          totalShortCallNotional += Math.abs(notional);
        } else {
          totalLongCallNotional += Math.abs(notional);
        }
      }

      if (pos.assetClassId && pos.assetClassName) {
        if (!byAssetClass[pos.assetClassId]) {
          byAssetClass[pos.assetClassId] = this.createAccumulator(
            pos.assetClassName,
            pos.assetClassColor || "#6366f1"
          );
        }

        // Calculate signed notional based on position type
        const sign = getOptionsNotionalSign(pos.position, pos.right);
        byAssetClass[pos.assetClassId].optionsNotional += notional * sign;
        byAssetClass[pos.assetClassId].optionsDelta += delta;

        totalOptionsNotional += Math.abs(notional);
        totalOptionsDelta += Math.abs(delta);
      }
    }

    // Calculate options cash impact
    let optionsCashImpact = 0;
    for (const id of Object.keys(byAssetClass)) {
      optionsCashImpact -= byAssetClass[id].optionsNotional;
    }

    // Add cash to byAssetClass if we have a Cash asset class
    const adjustedCashValue = includeOptions ? cashValue + optionsCashImpact : cashValue;

    if (cashAssetClass && (cashValue > 0 || (includeOptions && adjustedCashValue > 0))) {
      byAssetClass[cashAssetClass.id] = {
        name: cashAssetClass.name,
        color: cashAssetClass.color,
        stockValue: cashValue,
        optionsNotional: includeOptions ? -optionsCashImpact : 0,
        optionsDelta: 0,
        value: Math.max(0, adjustedCashValue),
        percentage: 0,
      };
    }

    // Total value is net liquidation (stocks + cash)
    const totalValue = totalStockValue + cashValue;

    // Calculate final values based on mode
    for (const id of Object.keys(byAssetClass)) {
      const ac = byAssetClass[id];
      // Skip cash - already set above
      if (cashAssetClass && id === cashAssetClass.id) continue;

      if (includeOptions) {
        ac.value = optionsWeightMode === "delta"
          ? ac.stockValue + ac.optionsDelta
          : ac.stockValue + ac.optionsNotional;
      } else {
        ac.value = ac.stockValue;
      }
    }

    // Calculate percentages
    for (const id of Object.keys(byAssetClass)) {
      byAssetClass[id].percentage = totalValue > 0
        ? (byAssetClass[id].value / totalValue) * 100
        : 0;
    }

    // Build options exposure summary
    for (const id of Object.keys(byAssetClass)) {
      const ac = byAssetClass[id];
      if (ac.optionsNotional !== 0 || ac.optionsDelta !== 0) {
        optionsExposure.push({
          assetClassId: id,
          assetClassName: ac.name,
          assetClassColor: ac.color,
          putNotional: 0,
          callNotional: 0,
          putDelta: 0,
          callDelta: 0,
          netNotional: ac.optionsNotional,
          netDelta: ac.optionsDelta,
        });
      }
    }

    return {
      byAssetClass: Object.entries(byAssetClass).map(([id, data]) => ({
        id,
        name: data.name,
        color: data.color,
        value: data.value,
        stockValue: data.stockValue,
        optionsNotional: data.optionsNotional,
        optionsDelta: data.optionsDelta,
        percentage: data.percentage,
      })),
      optionsExposure,
      totalValue,
      totalStockValue,
      totalOptionsNotional,
      totalOptionsDelta,
      totalPutNotional,
      totalShortPutNotional,
      totalLongPutNotional,
      totalCallNotional,
      totalShortCallNotional,
      totalLongCallNotional,
      totalPutDelta,
      totalCallDelta,
      unassignedValue,
      unassignedPercentage: totalValue > 0 ? (unassignedValue / totalValue) * 100 : 0,
    };
  }

  /**
   * Calculate current values by asset class from raw positions
   * Used for order impact calculations
   */
  calculateValuesByAssetClass(
    positions: Array<{
      symbol: string;
      secType: string;
      pos: number;
      avgCost: number;
    }>,
    assignmentMap: AssignmentMap
  ): {
    values: Record<string, { name: string; color: string; current: number; projected: number }>;
    totalValue: number;
  } {
    const values: Record<string, { name: string; color: string; current: number; projected: number }> = {};
    let totalValue = 0;

    for (const p of positions) {
      const value = Math.abs(p.pos * p.avgCost);
      totalValue += value;

      const assignment = assignmentMap.get(getSecurityKey(p.symbol, p.secType));

      if (assignment) {
        if (!values[assignment.assetClassId]) {
          values[assignment.assetClassId] = {
            name: assignment.assetClass.name,
            color: assignment.assetClass.color,
            current: 0,
            projected: 0,
          };
        }
        values[assignment.assetClassId].current += value;
        values[assignment.assetClassId].projected += value;
      }
    }

    return { values, totalValue };
  }

  /**
   * Apply order impact to projected values
   */
  applyOrderImpact(
    values: Record<string, { name: string; color: string; current: number; projected: number }>,
    order: {
      symbol: string;
      secType: string;
      action: "BUY" | "SELL";
      value: number;
    },
    assignmentMap: AssignmentMap
  ): number {
    const assignment = assignmentMap.get(getSecurityKey(order.symbol, order.secType));
    let valueDelta = 0;

    if (assignment) {
      if (!values[assignment.assetClassId]) {
        values[assignment.assetClassId] = {
          name: assignment.assetClass.name,
          color: assignment.assetClass.color,
          current: 0,
          projected: 0,
        };
      }

      if (order.action === "BUY") {
        values[assignment.assetClassId].projected += order.value;
        valueDelta = order.value;
      } else if (order.action === "SELL") {
        values[assignment.assetClassId].projected -= order.value;
        valueDelta = -order.value;
      }
    }

    return valueDelta;
  }

  /**
   * Convert values to allocation breakdown
   */
  toAllocationBreakdown(
    values: Record<string, { name: string; color: string; current: number; projected: number }>,
    totalCurrentValue: number,
    totalProjectedValue: number
  ): {
    currentAllocation: Array<{ id: string; name: string; color: string; value: number; percentage: number }>;
    projectedAllocation: Array<{ id: string; name: string; color: string; value: number; percentage: number }>;
  } {
    const currentAllocation = Object.entries(values).map(([id, data]) => ({
      id,
      name: data.name,
      color: data.color,
      value: data.current,
      percentage: totalCurrentValue > 0 ? (data.current / totalCurrentValue) * 100 : 0,
    }));

    const projectedAllocation = Object.entries(values).map(([id, data]) => ({
      id,
      name: data.name,
      color: data.color,
      value: data.projected,
      percentage: totalProjectedValue > 0 ? (data.projected / totalProjectedValue) * 100 : 0,
    }));

    return { currentAllocation, projectedAllocation };
  }

  private createAccumulator(name: string, color: string): AssetClassAccumulator {
    return {
      name,
      color,
      stockValue: 0,
      optionsNotional: 0,
      optionsDelta: 0,
      value: 0,
      percentage: 0,
    };
  }

}

export const allocationService = new AllocationService();

/**
 * Get underinvested asset classes based on active allocation profile and current positions.
 * Returns classes where current allocation is more than 1% below target, sorted by largest shortfall first.
 */
export async function getUnderinvestedClasses() {
  const activeProfile = await prisma.allocationProfile.findFirst({
    where: { isActive: true },
    include: {
      targets: { include: { assetClass: true } },
    },
  });

  if (!activeProfile) {
    return [];
  }

  let rawPositions: IBPosition[] = [];
  if (ibkrService.isConnected()) {
    try {
      rawPositions = await ibkrService.getPositions();
    } catch (err: unknown) {
      if (!isIgnorablePositionError(err)) {
        throw err;
      }
    }
  }

  const assignmentMap = await assignmentService.getAssignmentMap();
  const { values, totalValue } = allocationService.calculateValuesByAssetClass(
    rawPositions.map((p) => ({
      symbol: p.contract.symbol || "",
      secType: p.contract.secType || "",
      pos: p.pos,
      avgCost: p.avgCost,
    })),
    assignmentMap
  );

  return activeProfile.targets
    .map((t) => {
      const currentValue = values[t.assetClassId]?.current || 0;
      const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
      const diff = currentPct - t.targetPercentage;

      return {
        id: t.assetClassId,
        name: t.assetClass.name,
        color: t.assetClass.color,
        targetPercentage: t.targetPercentage,
        currentPercentage: currentPct,
        difference: diff,
        currentValue,
        targetValue: totalValue * (t.targetPercentage / 100),
        shortfall: totalValue * (t.targetPercentage / 100) - currentValue,
      };
    })
    .filter((c) => c.difference < -1)
    .sort((a, b) => a.difference - b.difference);
}
