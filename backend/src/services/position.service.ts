/**
 * Service for fetching and enriching position data
 */

import type { Contract } from "@stoqey/ib";
import { ibkrService, Position as IBPosition } from "./ibkr.js";
import { prisma } from "../db/index.js";
import { assignmentService, AssignmentMap } from "./assignment.service.js";
import { IBKRConnectionError } from "../errors/index.js";
import {
  formatDisplayName,
  getOptionRight,
  calculateOptionNotional,
  estimateDelta,
  OPTIONS_MULTIPLIER,
} from "@assup/shared";
import type {
  Position,
  PositionSummary,
  PositionSummaryParams,
  OptionsWeightMode,
} from "@assup/shared";
import { allocationService } from "./allocation.service.js";

class PositionService {
  /**
   * Get all positions enriched with asset class information
   */
  async getPositions(): Promise<Position[]> {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const [rawPositions, assignmentMap, cashAssetClass, accountData] = await Promise.all([
      this.fetchRawPositions(),
      assignmentService.getAssignmentMap(),
      prisma.assetClass.findFirst({ where: { name: "Cash" } }),
      Promise.resolve(ibkrService.getAccountData()),
    ]);

    const positions = this.enrichPositions(rawPositions, assignmentMap);

    // Fetch real greeks for option positions
    await this.applyRealDeltas(positions, rawPositions);

    // Add cash position if we have cash value
    const cashValue = accountData.totalCashValue || 0;
    if (cashValue > 0) {
      positions.push(
        this.createCashPosition(
          rawPositions[0]?.account || "",
          cashValue,
          cashAssetClass
        )
      );
    }

    return positions;
  }

  /**
   * Get position summary with allocation breakdown
   */
  async getSummary(params: PositionSummaryParams): Promise<PositionSummary> {
    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    const includeOptions = params.includeOptions ?? false;
    const optionsWeightMode: OptionsWeightMode = params.optionsWeightMode ?? "notional";

    const [rawPositions, assignmentMap, cashAssetClass] = await Promise.all([
      this.fetchRawPositions(),
      assignmentService.getAssignmentMap(),
      prisma.assetClass.findFirst({ where: { name: "Cash" } }),
    ]);

    const accountData = ibkrService.getAccountData();
    const cashValue = accountData.totalCashValue || 0;

    // Enrich positions
    const positions = this.enrichPositions(rawPositions, assignmentMap);

    // Fetch real greeks for option positions
    await this.applyRealDeltas(positions, rawPositions);

    // Add cash position
    if (cashValue > 0) {
      positions.push(
        this.createCashPosition(
          rawPositions[0]?.account || "",
          cashValue,
          cashAssetClass
        )
      );
    }

    // Calculate allocation
    const allocation = await allocationService.calculateAllocation(positions, {
      includeOptions,
      optionsWeightMode,
      cashValue,
    });

    return {
      positions,
      summary: {
        totalPositions: positions.length,
        totalValue: allocation.totalValue,
        totalStockValue: allocation.totalStockValue,
        totalOptionsNotional: allocation.totalOptionsNotional,
        totalOptionsDelta: allocation.totalOptionsDelta,
        totalPutNotional: allocation.totalPutNotional,
        totalShortPutNotional: allocation.totalShortPutNotional,
        totalLongPutNotional: allocation.totalLongPutNotional,
        totalCallNotional: allocation.totalCallNotional,
        totalShortCallNotional: allocation.totalShortCallNotional,
        totalLongCallNotional: allocation.totalLongCallNotional,
        totalPutDelta: allocation.totalPutDelta,
        totalCallDelta: allocation.totalCallDelta,
        totalTheta: positions.reduce((sum, p) => sum + (p.theta ?? 0), 0),
        unassignedValue: allocation.unassignedValue,
        unassignedPercentage: allocation.unassignedPercentage,
        includeOptions,
        optionsWeightMode,
        byAssetClass: allocation.byAssetClass,
        optionsExposure: allocation.optionsExposure,
      },
      account: {
        netLiquidation: accountData.netLiquidation || allocation.totalValue,
        cashValue: accountData.totalCashValue,
        availableFunds: accountData.availableFunds,
      },
    };
  }

  /**
   * Fetch raw positions from IBKR, handling errors gracefully
   */
  private async fetchRawPositions(): Promise<IBPosition[]> {
    try {
      return await ibkrService.getPositions();
    } catch (err: unknown) {
      const error = err as { message?: string; code?: string };
      // If positions request is not supported or times out, return empty array
      if (
        error.message?.includes("does not support positions") ||
        error.code === "timeout"
      ) {
        console.warn("TWS positions unavailable:", error.message || error.code);
        return [];
      }
      throw err;
    }
  }

  /**
   * Enrich raw positions with asset class information
   */
  private enrichPositions(
    rawPositions: IBPosition[],
    assignmentMap: AssignmentMap
  ): Position[] {
    return rawPositions
      .filter((p) => p.pos !== 0)
      .map((p) => this.enrichSinglePosition(p, assignmentMap));
  }

  /**
   * Enrich a single position with calculated fields and asset class info
   */
  private enrichSinglePosition(
    raw: IBPosition,
    assignmentMap: AssignmentMap
  ): Position {
    const contract = raw.contract;
    const symbol = contract.symbol || "";
    const secType = contract.secType || "";
    const isOption = secType === "OPT";

    const assignment = assignmentService.lookupAssignment(
      assignmentMap,
      symbol,
      secType
    );

    const costBasis = Math.abs(raw.pos * raw.avgCost);
    const hasMarketValue = raw.marketValue !== undefined && raw.marketValue !== null;
    const marketValue = hasMarketValue ? Math.abs(raw.marketValue!) : null;
    const unrealizedPnl = hasMarketValue
      ? raw.pos >= 0
        ? marketValue! - costBasis
        : costBasis - marketValue!
      : null;

    // Calculate option values
    const notionalValue = isOption
      ? calculateOptionNotional(contract.strike || 0, raw.pos, OPTIONS_MULTIPLIER)
      : undefined;
    const isLong = raw.pos > 0;
    const isPut = contract.right === "P";
    const deltaExposure = isOption && notionalValue
      ? estimateDelta(isLong, isPut) * notionalValue
      : undefined;

    return {
      account: raw.account,
      symbol: formatDisplayName(contract),
      conId: contract.conId || 0,
      secType,
      exchange: contract.exchange || contract.primaryExch || "",
      currency: contract.currency || "",
      position: raw.pos,
      avgCost: raw.avgCost,
      costBasis,
      marketValue,
      unrealizedPnl,
      strike: isOption ? contract.strike : undefined,
      expiry: isOption ? contract.lastTradeDateOrContractMonth : undefined,
      right: getOptionRight(contract),
      underlying: isOption ? symbol : undefined,
      notionalValue,
      deltaExposure,
      assetClassId: assignment?.assetClassId || null,
      assetClassName: assignment?.assetClass.name || null,
      assetClassColor: assignment?.assetClass.color || null,
    };
  }

  /**
   * Fetch real delta from IBKR market data for option positions and update deltaExposure.
   * Falls back to the estimated delta (0.5) if market data is unavailable.
   */
  private async applyRealDeltas(
    positions: Position[],
    rawPositions: IBPosition[]
  ): Promise<void> {
    // Collect option contracts that need delta
    const optionContracts: Contract[] = [];
    const indexByConId = new Map<number, number[]>();

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      if (pos.secType !== "OPT" || !pos.notionalValue || !pos.conId) continue;

      const raw = rawPositions.find(
        (r) => r.pos !== 0 && r.contract.conId === pos.conId
      );
      if (!raw) continue;

      if (!indexByConId.has(pos.conId)) {
        indexByConId.set(pos.conId, []);
        optionContracts.push(raw.contract);
      }
      indexByConId.get(pos.conId)!.push(i);
    }

    if (optionContracts.length === 0) return;

    // Fetch greeks via Observable API (which returns model greeks unlike snapshots)
    const greeks = await ibkrService.getOptionGreeks(optionContracts);

    // Apply real deltas and theta to positions
    for (const [conId, { delta, theta }] of greeks) {
      const indices = indexByConId.get(conId);
      if (!indices) continue;

      for (const idx of indices) {
        const pos = positions[idx];
        // IBKR delta is per-contract, signed by option type (+ for calls, - for puts).
        // Multiply by sign(position) to get portfolio delta direction:
        //   short put: (-0.3) * (-1) = +0.3 (bullish)
        //   long call: (+0.5) * (+1) = +0.5 (bullish)
        //   short call: (+0.5) * (-1) = -0.5 (bearish)
        const sign = pos.position >= 0 ? 1 : -1;
        pos.deltaExposure = delta * sign * pos.notionalValue!;

        // Theta: IBKR reports per-share daily theta (negative = decay).
        // Multiply by position * 100 (multiplier) so the sign naturally flips:
        //   short option: negative theta * negative position = positive $ (earning)
        //   long option: negative theta * positive position = negative $ (losing)
        if (theta != null) {
          pos.theta = theta * pos.position * 100;
        }
      }
    }
  }

  /**
   * Create a synthetic cash position
   */
  private createCashPosition(
    account: string,
    cashValue: number,
    cashAssetClass: { id: string; name: string; color: string } | null
  ): Position {
    return {
      account,
      symbol: "Cash",
      conId: 0,
      secType: "CASH",
      exchange: "",
      currency: "USD",
      position: Math.round(cashValue),
      avgCost: 1,
      costBasis: cashValue,
      marketValue: cashValue,
      unrealizedPnl: 0,
      assetClassId: cashAssetClass?.id || null,
      assetClassName: cashAssetClass?.name || null,
      assetClassColor: cashAssetClass?.color || null,
    };
  }
}

export const positionService = new PositionService();
