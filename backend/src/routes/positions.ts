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
  // Enriched data
  assetClassId?: string | null;
  assetClassName?: string | null;
  assetClassColor?: string | null;
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
router.get("/summary", async (req: Request, res: Response) => {
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

    // Calculate market values (position * avgCost as estimate if no market data)
    const positions: Position[] = rawPositions.map((p: any) => {
      const assignment = assignmentMap.get(`${p.contract.symbol}:${p.contract.secType}`);
      const marketValue = Math.abs(p.pos * p.avgCost);
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
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
      };
    });

    // Calculate totals by asset class
    const byAssetClass: Record<string, { name: string; color: string; value: number; percentage: number }> = {};
    let unassignedValue = 0;
    let totalValue = 0;

    for (const pos of positions) {
      const value = pos.marketValue || 0;
      totalValue += value;

      if (pos.assetClassId && pos.assetClassName) {
        if (!byAssetClass[pos.assetClassId]) {
          byAssetClass[pos.assetClassId] = {
            name: pos.assetClassName,
            color: pos.assetClassColor || "#6366f1",
            value: 0,
            percentage: 0,
          };
        }
        byAssetClass[pos.assetClassId].value += value;
      } else {
        unassignedValue += value;
      }
    }

    // Calculate percentages
    for (const id of Object.keys(byAssetClass)) {
      byAssetClass[id].percentage = totalValue > 0
        ? (byAssetClass[id].value / totalValue) * 100
        : 0;
    }

    res.json({
      positions,
      summary: {
        totalPositions: positions.length,
        totalValue,
        unassignedValue,
        unassignedPercentage: totalValue > 0 ? (unassignedValue / totalValue) * 100 : 0,
        byAssetClass: Object.entries(byAssetClass).map(([id, data]) => ({
          id,
          ...data,
        })),
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
