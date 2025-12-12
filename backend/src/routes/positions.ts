import { Router, Request, Response } from "express";
import { ibkrService, Position as IBPosition } from "../services/ibkr.js";
import { prisma } from "../db/index.js";
import { Contract } from "@stoqey/ib";

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
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
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
function calculateOptionNotional(contract: Contract, pos: number): number {
  const strike = contract.strike || 0;
  const quantity = Math.abs(pos);
  const multiplier = 100; // Standard option contract multiplier
  return strike * quantity * multiplier;
}

// Estimate delta for positions without market data
// Rough estimate: ATM ~0.5, ITM ~0.7-0.9, OTM ~0.1-0.3
// For simplicity, use 0.5 as default (can be replaced with real delta from market data)
function estimateDelta(contract: Contract, pos: number): number {
  // Without market data, we use a simplified delta estimate
  // Short puts: positive delta (want stock to go up)
  // Short calls: negative delta (want stock to go down)
  // Long puts: negative delta
  // Long calls: positive delta
  const isLong = pos > 0;
  const isPut = contract.right === "P";
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
    if (!ibkrService.isConnected()) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    // Fetch positions from TWS
    let rawPositions: IBPosition[] = [];
    try {
      console.log("Fetching positions from TWS...");
      rawPositions = await ibkrService.getPositions();
      console.log(`Got ${rawPositions.length} positions from TWS`);
    } catch (err: any) {
      // If positions request is not supported or times out, return empty array
      console.error("Error fetching positions:", err);
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
    const positions: Position[] = rawPositions.map((p) => {
      const contract = p.contract;
      const symbol = contract.symbol;
      const secType = contract.secType;
      const assignment = assignmentMap.get(`${symbol}:${secType}`);
      const costBasis = Math.abs(p.pos * p.avgCost);
      const hasMarketValue = p.marketValue !== undefined && p.marketValue !== null;
      const marketValue = hasMarketValue ? Math.abs(p.marketValue!) : null;
      const unrealizedPnl = hasMarketValue ? marketValue! - costBasis : null;
      return {
        account: p.account,
        symbol: symbol || "",
        conId: contract.conId || 0,
        secType: secType || "",
        exchange: contract.exchange || contract.primaryExch || "",
        currency: contract.currency || "",
        position: p.pos,
        avgCost: p.avgCost,
        costBasis,
        marketValue,
        unrealizedPnl,
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
    if (!ibkrService.isConnected()) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    const includeOptions = req.query.includeOptions === "true";
    const optionsWeightMode = (req.query.optionsWeightMode as string) || "notional";

    // Fetch positions from TWS
    let rawPositions: IBPosition[] = [];
    try {
      rawPositions = await ibkrService.getPositions();
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

    // Find Cash asset class for cash allocation
    const cashAssetClass = await prisma.assetClass.findFirst({
      where: { name: "Cash" },
    });

    // Calculate market values for positions
    const positions: Position[] = rawPositions.map((p) => {
      const contract = p.contract;
      const symbol = contract.symbol || "";
      const secType = contract.secType || "";
      const pos = p.pos;
      const avgCost = p.avgCost;

      const isOption = secType === "OPT";
      const lookupSymbol = symbol;
      const lookupSecType = isOption ? "STK" : secType;
      const assignment = assignmentMap.get(`${lookupSymbol}:${lookupSecType}`) ||
                        assignmentMap.get(`${symbol}:${secType}`);

      const costBasis = Math.abs(pos * avgCost);
      const hasMarketValue = p.marketValue !== undefined && p.marketValue !== null;
      const marketValue = hasMarketValue ? Math.abs(p.marketValue!) : null;
      const unrealizedPnl = hasMarketValue ? marketValue! - costBasis : null;
      const notionalValue = isOption ? calculateOptionNotional(contract, pos) : undefined;
      const deltaExposure = isOption ? estimateDelta(contract, pos) * notionalValue! : undefined;

      return {
        account: p.account,
        symbol,
        conId: contract.conId || 0,
        secType,
        exchange: contract.exchange || contract.primaryExch || "",
        currency: contract.currency || "",
        position: pos,
        avgCost,
        costBasis,
        marketValue,
        unrealizedPnl,
        strike: isOption ? contract.strike : undefined,
        expiry: isOption ? contract.lastTradeDateOrContractMonth : undefined,
        right: isOption ? (contract.right === "P" ? "P" : "C") : undefined,
        underlying: isOption ? symbol : undefined,
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

    // Get account data (cash balance) from the service
    const accountData = ibkrService.getAccountData();
    const cashValue = accountData.totalCashValue || 0;

    // Calculate the total cash impact from options if they were executed
    // Short puts: we'd spend cash to buy stock (negative cash impact)
    // Short calls: we'd receive cash from selling stock (positive cash impact)
    // Long puts: we'd receive cash from selling stock (positive cash impact)
    // Long calls: we'd spend cash to buy stock (negative cash impact)
    let optionsCashImpact = 0;
    for (const id of Object.keys(byAssetClass)) {
      // optionsNotional is already signed correctly:
      // - Positive for short puts and long calls (we acquire stock = spend cash)
      // - Negative for short calls and long puts (we sell stock = receive cash)
      optionsCashImpact -= byAssetClass[id].optionsNotional;
    }

    // Calculate adjusted cash value when options are included
    const adjustedCashValue = includeOptions ? cashValue + optionsCashImpact : cashValue;

    // Add cash to byAssetClass if we have a Cash asset class
    if (cashAssetClass) {
      const displayCashValue = includeOptions ? adjustedCashValue : cashValue;
      if (displayCashValue > 0 || (includeOptions && cashValue > 0)) {
        byAssetClass[cashAssetClass.id] = {
          name: cashAssetClass.name,
          color: cashAssetClass.color,
          stockValue: cashValue, // Original cash value
          optionsNotional: includeOptions ? -optionsCashImpact : 0, // Cash spent/received from options
          optionsDelta: 0,
          value: Math.max(0, displayCashValue), // Adjusted value (can't go negative in display)
          percentage: 0, // Will be calculated below
        };
      }
    }

    // Calculate final values based on mode
    // Total value is net liquidation - it doesn't change when options are executed
    // (we're just moving money between cash and securities)
    let totalValue = totalStockValue + cashValue;

    for (const id of Object.keys(byAssetClass)) {
      const ac = byAssetClass[id];
      // Skip cash - already set above
      if (cashAssetClass && id === cashAssetClass.id) continue;

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

    // When including options, total stays same (net liquidation) but allocation shifts
    // We don't recalculate totalValue - it should equal netLiquidation

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
        netLiquidation: accountData.netLiquidation || totalValue,
        cashValue: accountData.totalCashValue,
        availableFunds: accountData.availableFunds,
      },
    });
  } catch (error) {
    console.error("Failed to fetch position summary:", error);
    res.status(500).json({ error: "Failed to fetch position summary from TWS" });
  }
});

export default router;
