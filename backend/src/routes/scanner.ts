import { Router, Request, Response } from "express";
import { ibkrService } from "../services/ibkr.js";
import { prisma } from "../db/index.js";

const router = Router();

export interface ScannerCriteria {
  minDaysToExpiry: number;
  maxDaysToExpiry: number;
  minDelta: number;
  maxDelta: number;
  minAnnualizedReturn: number;
  minPremiumPercent: number;
  targetAssetClasses?: string[];
}

export interface OptionOpportunity {
  symbol: string;
  underlyingPrice: number;
  strike: number;
  expiry: string;
  optionType: "CALL" | "PUT";
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  impliedVolatility: number;
  daysToExpiry: number;
  annualizedReturn: number;
  premiumPercent: number;
  assetClassId?: string;
  assetClassName?: string;
  assetClassColor?: string;
}

// GET /api/scanner/presets - List saved scanner presets
router.get("/presets", async (req: Request, res: Response) => {
  try {
    const presets = await prisma.scannerPreset.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    res.json(presets);
  } catch (error) {
    console.error("Failed to fetch scanner presets:", error);
    res.status(500).json({ error: "Failed to fetch scanner presets" });
  }
});

// GET /api/scanner/presets/:id - Get single preset
router.get("/presets/:id", async (req: Request, res: Response) => {
  try {
    const preset = await prisma.scannerPreset.findUnique({
      where: { id: req.params.id },
    });
    if (!preset) {
      res.status(404).json({ error: "Scanner preset not found" });
      return;
    }
    res.json(preset);
  } catch (error) {
    console.error("Failed to fetch scanner preset:", error);
    res.status(500).json({ error: "Failed to fetch scanner preset" });
  }
});

// POST /api/scanner/presets - Create scanner preset
router.post("/presets", async (req: Request, res: Response) => {
  try {
    const { name, criteria, isDefault } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (!criteria || typeof criteria !== "object") {
      res.status(400).json({ error: "Criteria is required" });
      return;
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.scannerPreset.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const preset = await prisma.scannerPreset.create({
      data: {
        name: name.trim(),
        criteria,
        isDefault: isDefault || false,
      },
    });
    res.status(201).json(preset);
  } catch (error) {
    console.error("Failed to create scanner preset:", error);
    res.status(500).json({ error: "Failed to create scanner preset" });
  }
});

// PUT /api/scanner/presets/:id - Update scanner preset
router.put("/presets/:id", async (req: Request, res: Response) => {
  try {
    const { name, criteria, isDefault } = req.body;

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.scannerPreset.updateMany({
        where: { isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const preset = await prisma.scannerPreset.update({
      where: { id: req.params.id },
      data: {
        name: name?.trim(),
        criteria,
        isDefault,
      },
    });
    res.json(preset);
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Scanner preset not found" });
      return;
    }
    console.error("Failed to update scanner preset:", error);
    res.status(500).json({ error: "Failed to update scanner preset" });
  }
});

// DELETE /api/scanner/presets/:id - Delete scanner preset
router.delete("/presets/:id", async (req: Request, res: Response) => {
  try {
    await prisma.scannerPreset.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Scanner preset not found" });
      return;
    }
    console.error("Failed to delete scanner preset:", error);
    res.status(500).json({ error: "Failed to delete scanner preset" });
  }
});

// POST /api/scanner/scan - Run options scan
router.post("/scan", async (req: Request, res: Response) => {
  try {
    const criteria: ScannerCriteria = req.body;

    // Validate criteria
    if (!criteria.minDaysToExpiry || !criteria.maxDaysToExpiry) {
      res.status(400).json({ error: "Days to expiry range is required" });
      return;
    }

    const client = ibkrService.getClient();
    if (!client) {
      res.status(503).json({ error: "Not connected to TWS" });
      return;
    }

    // Get underinvested asset classes if not specified
    let targetAssetClasses = criteria.targetAssetClasses;
    if (!targetAssetClasses || targetAssetClasses.length === 0) {
      // Get active allocation profile
      const activeProfile = await prisma.allocationProfile.findFirst({
        where: { isActive: true },
        include: {
          targets: { include: { assetClass: true } },
        },
      });

      if (activeProfile) {
        // Get current positions
        let positions: any[] = [];
        try {
          const result = await client.getPositions();
          positions = Array.isArray(result) ? result : [];
        } catch (err: any) {
          if (!err.message?.includes("does not support positions") && err.code !== "timeout") {
            throw err;
          }
        }

        // Get security assignments
        const assignments = await prisma.securityAssignment.findMany();
        const assignmentMap = new Map(
          assignments.map((a) => [`${a.symbol}:${a.secType}`, a.assetClassId])
        );

        // Calculate current allocation
        const currentByClass: Record<string, number> = {};
        let totalValue = 0;
        for (const p of positions) {
          const value = Math.abs(p.pos * p.avgCost);
          totalValue += value;
          const assetClassId = assignmentMap.get(`${p.contract.symbol}:${p.contract.secType}`);
          if (assetClassId) {
            currentByClass[assetClassId] = (currentByClass[assetClassId] || 0) + value;
          }
        }

        // Find underinvested classes
        targetAssetClasses = activeProfile.targets
          .filter((t) => {
            const currentPct = totalValue > 0
              ? ((currentByClass[t.assetClassId] || 0) / totalValue) * 100
              : 0;
            return currentPct < t.targetPercentage - 1; // At least 1% under target
          })
          .map((t) => t.assetClassId);
      }
    }

    // Get symbols for target asset classes (deduplicated, only STK type)
    const targetSymbols = await prisma.securityAssignment.findMany({
      where: {
        ...(targetAssetClasses?.length
          ? { assetClassId: { in: targetAssetClasses } }
          : {}),
        secType: "STK", // Only scan stocks, not options
      },
      include: { assetClass: true },
      distinct: ["symbol"], // Ensure unique symbols
    });

    // Note: Actual options scanning would require TWS market data subscriptions
    // For now, return empty results with a message
    // This would be enhanced with actual options chain data from TWS

    // Get unique symbols
    const uniqueSymbols = [...new Set(targetSymbols.map((s) => s.symbol))];

    res.json({
      criteria,
      targetAssetClasses: targetAssetClasses || [],
      symbolsScanned: uniqueSymbols,
      opportunities: [],
      message: "Options scanning requires market data subscriptions. Configure TWS market data for target symbols.",
    });
  } catch (error) {
    console.error("Failed to run options scan:", error);
    res.status(500).json({ error: "Failed to run options scan" });
  }
});

// GET /api/scanner/underinvested - Get underinvested asset classes
router.get("/underinvested", async (req: Request, res: Response) => {
  try {
    const client = ibkrService.getClient();

    // Get active allocation profile
    const activeProfile = await prisma.allocationProfile.findFirst({
      where: { isActive: true },
      include: {
        targets: { include: { assetClass: true } },
      },
    });

    if (!activeProfile) {
      res.json({ underinvested: [], message: "No active allocation profile" });
      return;
    }

    // Get current positions
    let positions: any[] = [];
    if (client) {
      try {
        const result = await client.getPositions();
        positions = Array.isArray(result) ? result : [];
      } catch (err: any) {
        if (!err.message?.includes("does not support positions") && err.code !== "timeout") {
          throw err;
        }
      }
    }

    // Get security assignments
    const assignments = await prisma.securityAssignment.findMany();
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a.assetClassId])
    );

    // Calculate current allocation
    const currentByClass: Record<string, number> = {};
    let totalValue = 0;
    for (const p of positions) {
      const value = Math.abs(p.pos * p.avgCost);
      totalValue += value;
      const assetClassId = assignmentMap.get(`${p.contract.symbol}:${p.contract.secType}`);
      if (assetClassId) {
        currentByClass[assetClassId] = (currentByClass[assetClassId] || 0) + value;
      }
    }

    // Find underinvested classes
    const underinvested = activeProfile.targets
      .map((t) => {
        const currentValue = currentByClass[t.assetClassId] || 0;
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
      .filter((c) => c.difference < -1) // At least 1% under target
      .sort((a, b) => a.difference - b.difference); // Most underinvested first

    res.json({ underinvested, totalPortfolioValue: totalValue });
  } catch (error) {
    console.error("Failed to get underinvested classes:", error);
    res.status(500).json({ error: "Failed to get underinvested classes" });
  }
});

export default router;
