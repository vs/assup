/**
 * Scanner API routes
 * Options scanner for finding opportunities in underinvested asset classes
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { ibkrService, Position as IBPosition } from "../services/ibkr.js";
import { assignmentService, getSecurityKey } from "../services/assignment.service.js";
import { allocationService } from "../services/allocation.service.js";
import {
  scannerPresetCreateSchema,
  scannerPresetUpdateSchema,
  scannerPresetIdParamSchema,
  scannerCriteriaSchema,
} from "@assup/shared";
import { NotFoundError, IBKRConnectionError } from "../errors/index.js";

const router = Router();

/**
 * GET /api/scanner/presets
 * List all saved scanner presets
 */
router.get(
  "/presets",
  asyncHandler(async (req, res) => {
    const presets = await prisma.scannerPreset.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    res.json(presets);
  })
);

/**
 * GET /api/scanner/presets/:id
 * Get a single preset
 */
router.get(
  "/presets/:id",
  validate({ params: scannerPresetIdParamSchema }),
  asyncHandler(async (req, res) => {
    const preset = await prisma.scannerPreset.findUnique({
      where: { id: req.params.id },
    });

    if (!preset) {
      throw new NotFoundError("Scanner preset not found");
    }

    res.json(preset);
  })
);

/**
 * POST /api/scanner/presets
 * Create a new preset
 */
router.post(
  "/presets",
  validate({ body: scannerPresetCreateSchema }),
  asyncHandler(async (req, res) => {
    const { name, criteria, isDefault } = req.body;

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.scannerPreset.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const preset = await prisma.scannerPreset.create({
      data: {
        name,
        criteria,
        isDefault: isDefault || false,
      },
    });

    res.status(201).json(preset);
  })
);

/**
 * PUT /api/scanner/presets/:id
 * Update a preset
 */
router.put(
  "/presets/:id",
  validate({ params: scannerPresetIdParamSchema, body: scannerPresetUpdateSchema }),
  asyncHandler(async (req, res) => {
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
      data: { name, criteria, isDefault },
    });

    res.json(preset);
  })
);

/**
 * DELETE /api/scanner/presets/:id
 * Delete a preset
 */
router.delete(
  "/presets/:id",
  validate({ params: scannerPresetIdParamSchema }),
  asyncHandler(async (req, res) => {
    await prisma.scannerPreset.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  })
);

/**
 * POST /api/scanner/scan
 * Run options scan based on criteria
 */
router.post(
  "/scan",
  validate({ body: scannerCriteriaSchema }),
  asyncHandler(async (req, res) => {
    const criteria = req.body;

    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    // Get underinvested asset classes if not specified
    let targetAssetClasses = criteria.targetAssetClasses;
    if (!targetAssetClasses || targetAssetClasses.length === 0) {
      const underinvested = await getUnderinvestedClasses();
      targetAssetClasses = underinvested.map((c) => c.id);
    }

    // Get symbols for target asset classes (only STK type)
    const targetSymbols = await prisma.securityAssignment.findMany({
      where: {
        ...(targetAssetClasses.length ? { assetClassId: { in: targetAssetClasses } } : {}),
        secType: "STK",
      },
      include: { assetClass: true },
      distinct: ["symbol"],
    });

    const uniqueSymbols = [...new Set(targetSymbols.map((s) => s.symbol))];

    if (uniqueSymbols.length === 0) {
      res.json({
        criteria,
        targetAssetClasses: targetAssetClasses || [],
        symbolsScanned: [],
        opportunities: [],
        message: "No symbols found for target asset classes",
      });
      return;
    }

    // Scan for options opportunities
    const opportunities = await scanOptionsForSymbols(uniqueSymbols, targetSymbols, criteria);

    res.json({
      criteria,
      targetAssetClasses: targetAssetClasses || [],
      symbolsScanned: uniqueSymbols,
      opportunities,
    });
  })
);

/**
 * GET /api/scanner/underinvested
 * Get list of underinvested asset classes
 */
router.get(
  "/underinvested",
  asyncHandler(async (req, res) => {
    const underinvested = await getUnderinvestedClasses();
    const totalValue = underinvested.reduce((sum, c) => sum + c.targetValue, 0) /
      (underinvested[0]?.targetPercentage ? 100 / underinvested[0].targetPercentage : 1);

    res.json({ underinvested, totalPortfolioValue: totalValue });
  })
);

/**
 * Scan options for given symbols based on criteria
 */
async function scanOptionsForSymbols(
  symbols: string[],
  symbolAssignments: Array<{ symbol: string; assetClass: { name: string; color: string } }>,
  criteria: {
    minDaysToExpiry: number;
    maxDaysToExpiry: number;
    minDelta: number;
    maxDelta: number;
    minAnnualizedReturn: number;
    minPremiumPercent: number;
  }
) {
  const opportunities: Array<{
    symbol: string;
    assetClassName: string;
    assetClassColor: string;
    strike: number;
    expiration: string;
    daysToExpiry: number;
    optionType: "CALL" | "PUT";
    bid: number;
    ask: number;
    midPrice: number;
    delta?: number;
    annualizedReturn: number;
    premiumPercent: number;
  }> = [];

  // Create a map for quick lookup of asset class info
  const symbolToAssetClass = new Map(
    symbolAssignments.map((s) => [s.symbol, { name: s.assetClass.name, color: s.assetClass.color }])
  );

  for (const symbol of symbols) {
    const assetClassInfo = symbolToAssetClass.get(symbol);
    if (!assetClassInfo) continue;

    try {
      console.log(`Scanning options for ${symbol}...`);

      // Get options chain
      const chain = await ibkrService.getOptionChain(symbol);
      if (chain.length === 0) {
        console.log(`No options chain found for ${symbol}`);
        continue;
      }

      // Filter by expiration date
      const today = new Date();
      const filteredChain = chain.filter((entry) => {
        const expirationDate = parseExpirationDate(entry.expiration);
        const daysToExpiry = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return daysToExpiry >= criteria.minDaysToExpiry && daysToExpiry <= criteria.maxDaysToExpiry;
      });

      if (filteredChain.length === 0) {
        console.log(`No options in expiration range for ${symbol}`);
        continue;
      }

      // Collect contracts to get market data for (only put options for cash-secured puts)
      const contracts = filteredChain.map((entry) => entry.put);

      // Get market data for options contracts (NOT the underlying!)
      console.log(`Getting market data for ${contracts.length} option contracts...`);
      const marketDataMap = await ibkrService.getMarketDataBatch(contracts);

      // Process each option and calculate metrics
      for (const entry of filteredChain) {
        const expirationDate = parseExpirationDate(entry.expiration);
        const daysToExpiry = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Process PUT option (cash-secured put strategy)
        const putKey = `${entry.put.symbol}_${entry.put.lastTradeDateOrContractMonth}_${entry.put.strike}_${entry.put.right}`;
        const putData = marketDataMap.get(putKey);

        if (putData && putData.bid && putData.ask) {
          const midPrice = (putData.bid + putData.ask) / 2;
          const premiumPercent = (midPrice / entry.strike) * 100;
          const annualizedReturn = (premiumPercent * 365) / daysToExpiry;

          // Filter by criteria
          if (annualizedReturn >= criteria.minAnnualizedReturn && premiumPercent >= criteria.minPremiumPercent) {
            opportunities.push({
              symbol,
              assetClassName: assetClassInfo.name,
              assetClassColor: assetClassInfo.color,
              strike: entry.strike,
              expiration: entry.expiration,
              daysToExpiry,
              optionType: "PUT",
              bid: putData.bid,
              ask: putData.ask,
              midPrice,
              annualizedReturn,
              premiumPercent,
            });
          }
        }
      }

      console.log(`Found ${opportunities.length} opportunities for ${symbol}`);
    } catch (err) {
      console.error(`Error scanning options for ${symbol}:`, err);
    }
  }

  // Sort by annualized return descending
  opportunities.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

  return opportunities;
}

/**
 * Parse expiration date string (format: YYYYMMDD or YYMMDD)
 */
function parseExpirationDate(expiration: string): Date {
  let year: number;
  let month: number;
  let day: number;

  if (expiration.length === 8) {
    // YYYYMMDD
    year = parseInt(expiration.substring(0, 4), 10);
    month = parseInt(expiration.substring(4, 6), 10) - 1; // Month is 0-indexed
    day = parseInt(expiration.substring(6, 8), 10);
  } else if (expiration.length === 6) {
    // YYMMDD
    year = 2000 + parseInt(expiration.substring(0, 2), 10);
    month = parseInt(expiration.substring(2, 4), 10) - 1;
    day = parseInt(expiration.substring(4, 6), 10);
  } else {
    throw new Error(`Invalid expiration format: ${expiration}`);
  }

  return new Date(year, month, day);
}

/**
 * Helper to calculate underinvested asset classes
 */
async function getUnderinvestedClasses() {
  // Get active allocation profile
  const activeProfile = await prisma.allocationProfile.findFirst({
    where: { isActive: true },
    include: {
      targets: { include: { assetClass: true } },
    },
  });

  if (!activeProfile) {
    return [];
  }

  // Get current positions if connected
  let rawPositions: IBPosition[] = [];
  if (ibkrService.isConnected()) {
    try {
      rawPositions = await ibkrService.getPositions();
    } catch (err: unknown) {
      const error = err as { message?: string; code?: string };
      if (!error.message?.includes("does not support positions") && error.code !== "timeout") {
        throw err;
      }
    }
  }

  // Calculate allocation using the service
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

  // Find underinvested classes
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

export default router;
