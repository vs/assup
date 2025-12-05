import { Router, Request, Response } from "express";
import { ibkrService } from "../services/ibkr.js";
import { prisma } from "../db/index.js";

const router = Router();

export interface Position {
  account: string;
  symbol: string;
  conId: number;
  secType: string;
  exchange: string;
  currency: string;
  position: number;
  avgCost: number;
  marketValue?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  // Option-specific fields
  strike?: number;
  expiry?: string;
  right?: "C" | "P";
  underlying?: string;
  notionalValue?: number;
  deltaExposure?: number;
  // Enriched data
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
}

interface OptionsExposure {
  assetClassId: string;
  assetClassName: string;
  assetClassColor: string;
  putNotional: number;
  callNotional: number;
  putDelta: number;
  callDelta: number;
  netNotional: number;
  netDelta: number;
}

// Calculate notional value for an option position
// PUT: notional = strike * quantity * 100 (exposure if assigned)
// CALL: notional = strike * quantity * 100 (exposure if exercised, but reduces stock allocation)
function calculateOptionNotional(pos: any): number {
  const strike = pos.contract.strike || 0;
  const quantity = Math.abs(pos.pos);
  const multiplier = 100; // Standard option contract multiplier
  return strike * quantity * multiplier;
}

// Estimate delta for positions without market data
// Rough estimate: ATM ~0.5, ITM ~0.7-0.9, OTM ~0.1-0.3
// For simplicity, use 0.5 as default (can be replaced with real delta from market data)
function estimateDelta(pos: any): number {
  // Without market data, we use a simplified delta estimate
  // Short puts: positive delta (want stock to go up)
  // Short calls: negative delta (want stock to go down)
  // Long puts: negative delta
  // Long calls: positive delta
  const isLong = pos.pos > 0;
  const isPut = pos.contract.right === "P";
  const baseDelta = 0.5; // Simplified ATM assumption

  if (isPut) {
    return isLong ? -baseDelta : baseDelta;
  } else {
    return isLong ? baseDelta : -baseDelta;
  }
}

// GET /api/positions - Fetch all positions from TWS
router.get("/", async (req: Request, res: Response) => {
  try {
    const client = ibkrService.getClient();
    if (!client) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    // Fetch positions from TWS
    let rawPositions: any[] = [];
    try {
      const result = await client.getPositions();
      rawPositions = Array.isArray(result) ? result : [];
    } catch (err: any) {
      // If positions request is not supported or times out, return empty array
      if (err.message?.includes("does not support positions") || err.code === "timeout") {
        console.warn("TWS positions unavailable:", err.message || err.code);
        rawPositions = [];
      } else {
        throw err;
      }
    }

    // Get all security assignments for enrichment
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a])
    );

    // Enrich positions with asset class info
    const positions: Position[] = rawPositions.map((p: any) => {
      const assignment = assignmentMap.get(`${p.contract.symbol}:${p.contract.secType}`);
      return {
        account: p.account,
        symbol: p.contract.symbol,
        conId: p.contract.conId,
        secType: p.contract.secType,
        exchange: p.contract.exchange || p.contract.primaryExchange || "",
        currency: p.contract.currency,
        position: p.pos,
        avgCost: p.avgCost,
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
      };
    });

    res.json(positions);
  } catch (error) {
    console.error("Failed to fetch positions:", error);
    res.status(500).json({ error: "Failed to fetch positions from TWS" });
  }
});

// GET /api/positions/summary - Get position summary with market values
// Query params:
//   includeOptions: "true" | "false" - whether to include options in allocation
//   optionsWeightMode: "notional" | "delta" - how to weight options
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const client = ibkrService.getClient();
    if (!client) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    const includeOptions = req.query.includeOptions === "true";
    const optionsWeightMode = (req.query.optionsWeightMode as string) || "notional";

    // Fetch positions from TWS
    let rawPositions: any[] = [];
    try {
      const result = await client.getPositions();
      rawPositions = Array.isArray(result) ? result : [];
    } catch (err: any) {
      // If positions request is not supported or times out, return empty array
      if (err.message?.includes("does not support positions") || err.code === "timeout") {
        console.warn("TWS positions unavailable:", err.message || err.code);
        rawPositions = [];
      } else {
        throw err;
      }
    }

    // Get all security assignments for enrichment
    // For options, we look up by underlying symbol
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a])
    );

    // Separate stock and option positions
    const stockPositions: any[] = [];
    const optionPositions: any[] = [];

    for (const p of rawPositions) {
      if (p.contract.secType === "OPT") {
        optionPositions.push(p);
      } else {
        stockPositions.push(p);
      }
    }

    // Calculate market values for stock positions
    const positions: Position[] = rawPositions.map((p: any) => {
      const isOption = p.contract.secType === "OPT";
      const lookupSymbol = isOption ? p.contract.symbol : p.contract.symbol; // Options use underlying symbol
      const lookupSecType = isOption ? "STK" : p.contract.secType; // Look up assignment by underlying
      const assignment = assignmentMap.get(`${lookupSymbol}:${lookupSecType}`) ||
                        assignmentMap.get(`${p.contract.symbol}:${p.contract.secType}`);

      const marketValue = Math.abs(p.pos * p.avgCost);
      const notionalValue = isOption ? calculateOptionNotional(p) : undefined;
      const deltaExposure = isOption ? estimateDelta(p) * notionalValue! : undefined;

      return {
        account: p.account,
        symbol: p.contract.symbol,
        conId: p.contract.conId,
        secType: p.contract.secType,
        exchange: p.contract.exchange || p.contract.primaryExchange || "",
        currency: p.contract.currency,
        position: p.pos,
        avgCost: p.avgCost,
        marketValue,
        strike: isOption ? p.contract.strike : undefined,
        expiry: isOption ? p.contract.lastTradeDateOrContractMonth : undefined,
        right: isOption ? (p.contract.right === "P" ? "P" : "C") : undefined,
        underlying: isOption ? p.contract.symbol : undefined,
        notionalValue,
        deltaExposure,
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
      };
    });

    // Calculate totals by asset class (stocks only first)
    const byAssetClass: Record<string, {
      name: string;
      color: string;
      stockValue: number;
      optionsNotional: number;
      optionsDelta: number;
      value: number;
      percentage: number;
    }> = {};
    let unassignedValue = 0;
    let totalStockValue = 0;

    // First pass: stocks
    for (const pos of positions) {
      if (pos.secType === "OPT") continue;

      const value = pos.marketValue || 0;
      totalStockValue += value;

      if (pos.assetClassId && pos.assetClassName) {
        if (!byAssetClass[pos.assetClassId]) {
          byAssetClass[pos.assetClassId] = {
            name: pos.assetClassName,
            color: pos.assetClassColor || "#6366f1",
            stockValue: 0,
            optionsNotional: 0,
            optionsDelta: 0,
            value: 0,
            percentage: 0,
          };
        }
        byAssetClass[pos.assetClassId].stockValue += value;
      } else {
        unassignedValue += value;
      }
    }

    // Second pass: options exposure
    const optionsExposure: OptionsExposure[] = [];
    let totalOptionsNotional = 0;
    let totalOptionsDelta = 0;

    for (const pos of positions) {
      if (pos.secType !== "OPT") continue;

      const notional = pos.notionalValue || 0;
      const delta = pos.deltaExposure || 0;
      const isPut = pos.right === "P";
      const isShort = pos.position < 0;

      if (pos.assetClassId && pos.assetClassName) {
        if (!byAssetClass[pos.assetClassId]) {
          byAssetClass[pos.assetClassId] = {
            name: pos.assetClassName,
            color: pos.assetClassColor || "#6366f1",
            stockValue: 0,
            optionsNotional: 0,
            optionsDelta: 0,
            value: 0,
            percentage: 0,
          };
        }

        // Short puts add notional exposure (you may have to buy)
        // Short calls reduce exposure (you may have to sell)
        // Long puts: hedge (negative notional)
        // Long calls: additional exposure (positive notional)
        if (isPut) {
          if (isShort) {
            byAssetClass[pos.assetClassId].optionsNotional += notional;
          } else {
            byAssetClass[pos.assetClassId].optionsNotional -= notional;
          }
        } else {
          // Calls
          if (isShort) {
            byAssetClass[pos.assetClassId].optionsNotional -= notional;
          } else {
            byAssetClass[pos.assetClassId].optionsNotional += notional;
          }
        }

        byAssetClass[pos.assetClassId].optionsDelta += delta;
        totalOptionsNotional += Math.abs(notional);
        totalOptionsDelta += Math.abs(delta);
      }
    }

    // Calculate final values based on mode
    let totalValue = totalStockValue;

    for (const id of Object.keys(byAssetClass)) {
      const ac = byAssetClass[id];
      if (includeOptions) {
        if (optionsWeightMode === "delta") {
          ac.value = ac.stockValue + ac.optionsDelta;
        } else {
          ac.value = ac.stockValue + ac.optionsNotional;
        }
      } else {
        ac.value = ac.stockValue;
      }
    }

    // Recalculate total if including options
    if (includeOptions) {
      totalValue = Object.values(byAssetClass).reduce((sum, ac) => sum + Math.max(0, ac.value), 0) + unassignedValue;
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
          putNotional: 0, // Would need more tracking to split
          callNotional: 0,
          putDelta: 0,
          callDelta: 0,
          netNotional: ac.optionsNotional,
          netDelta: ac.optionsDelta,
        });
      }
    }

    res.json({
      positions,
      summary: {
        totalPositions: positions.length,
        totalValue,
        totalStockValue,
        totalOptionsNotional,
        totalOptionsDelta,
        unassignedValue,
        unassignedPercentage: totalValue > 0 ? (unassignedValue / totalValue) * 100 : 0,
        includeOptions,
        optionsWeightMode,
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
      },
      account: {
        // Account summary not available via ib-tws-api, calculate from positions
        netLiquidation: totalValue,
        cashValue: 0,
      },
    });
  } catch (error) {
    console.error("Failed to fetch position summary:", error);
    res.status(500).json({ error: "Failed to fetch position summary from TWS" });
  }
});

export default router;
