/**
 * Scanner API routes
 * Options scanner for finding opportunities in underinvested asset classes
 */

import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { ibkrService } from "../services/ibkr.js";
import { getUnderinvestedClasses } from "../services/allocation.service.js";
import { sseService } from "../services/sse.js";
import { scanSymbols } from "../services/optionScan.service.js";
import {
  scannerPresetCreateSchema,
  scannerPresetUpdateSchema,
  scannerPresetIdParamSchema,
  scannerCriteriaSchema,
} from "@assup/shared";
import type { ScannerCriteria } from "@assup/shared";
import { NotFoundError, IBKRConnectionError } from "../errors/index.js";
import { isIgnorablePositionError } from "../utils/index.js";

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

    let uniqueSymbols: string[];

    // If specificSymbol is provided, use only that symbol
    if (criteria.specificSymbol) {
      uniqueSymbols = [criteria.specificSymbol.toUpperCase()];
    } else {
      // Get symbols from positions and watchlists
      const symbolsSet = new Set<string>();

      // Get symbols from current positions
      try {
        const positions = await ibkrService.getPositions();
        positions.forEach((pos) => {
          if (pos.contract.secType === "STK" && pos.contract.symbol) {
            symbolsSet.add(pos.contract.symbol);
          }
        });
      } catch (err: unknown) {
        if (!isIgnorablePositionError(err)) {
          throw err;
        }
      }

      // Get symbols from all watchlists
      const watchlistItems = await prisma.watchlistItem.findMany({
        where: {
          secType: "STK",
        },
        select: {
          symbol: true,
        },
      });

      watchlistItems.forEach((item) => symbolsSet.add(item.symbol));

      uniqueSymbols = Array.from(symbolsSet);
    }

    if (uniqueSymbols.length === 0) {
      res.json({
        criteria,
        targetAssetClasses: [],
        symbolsScanned: [],
        opportunities: [],
        message: "No symbols found in positions or watchlists",
      });
      return;
    }

    // Get asset class assignments for these symbols
    const assignmentWhere: Prisma.SecurityAssignmentWhereInput = {
      symbol: { in: uniqueSymbols },
      secType: "STK",
      ...(criteria.targetAssetClasses && criteria.targetAssetClasses.length > 0
        ? { assetClassId: { in: criteria.targetAssetClasses } }
        : {}),
    };

    const assignments = await prisma.securityAssignment.findMany({
      where: assignmentWhere,
      include: { assetClass: true },
    });

    // Filter symbols to only those with assignments (if targetAssetClasses specified)
    const filteredSymbols = criteria.targetAssetClasses && criteria.targetAssetClasses.length > 0
      ? assignments.map(a => a.symbol)
      : uniqueSymbols;

    if (filteredSymbols.length === 0) {
      res.json({
        criteria,
        targetAssetClasses: criteria.targetAssetClasses || [],
        symbolsScanned: [],
        opportunities: [],
        message: criteria.targetAssetClasses && criteria.targetAssetClasses.length > 0
          ? "No symbols found with assignments to the selected asset classes"
          : "No symbols found in positions or watchlists",
      });
      return;
    }

    // Create symbol to asset class mapping
    const symbolAssignments = filteredSymbols.map((symbol) => {
      const assignment = assignments.find((a) => a.symbol === symbol);
      return {
        symbol,
        assetClass: assignment
          ? { name: assignment.assetClass.name, color: assignment.assetClass.color }
          : { name: "Unassigned", color: "#6b7280" },
      };
    });

    // Scan for options opportunities
    const opportunities = await scanOptionsForSymbols(symbolAssignments, criteria);

    res.json({
      criteria,
      targetAssetClasses: criteria.targetAssetClasses || [],
      symbolsScanned: filteredSymbols,
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
 * Scan options for given symbols based on criteria.
 * Delegates to the shared optionScan service, wiring SSE progress callbacks.
 */
async function scanOptionsForSymbols(
  symbolAssignmentsList: Array<{ symbol: string; assetClass: { name: string; color: string } }>,
  criteria: ScannerCriteria,
) {
  const symbolAssignments = new Map(
    symbolAssignmentsList.map((s) => [s.symbol, { name: s.assetClass.name, color: s.assetClass.color }]),
  );

  const totalSymbols = symbolAssignments.size;
  let currentSymbol = 0;

  console.log(`\n=== Starting Options Scan for ${totalSymbols} symbols ===\n`);

  sseService.broadcast("scanner", {
    status: "started",
    totalSymbols,
    currentSymbol: 0,
    message: `Starting scan for ${totalSymbols} symbols`,
  });

  const opportunities = await scanSymbols({
    symbolAssignments,
    criteria,
    callbacks: {
      onSymbolComplete(symbol, assetClass, symbolOpportunities) {
        currentSymbol++;
        console.log(`[${currentSymbol}/${totalSymbols}] ${symbol} (${assetClass}): ${symbolOpportunities.length} opportunities`);

        sseService.broadcast("scanner", {
          status: "symbol_complete",
          totalSymbols,
          currentSymbol,
          symbol,
          assetClass,
          opportunities: symbolOpportunities,
          message: `Found ${symbolOpportunities.length} opportunities for ${symbol}`,
        });
      },
      onFetching(symbol, assetClass, contractCount) {
        sseService.broadcast("scanner", {
          status: "fetching",
          totalSymbols,
          currentSymbol: currentSymbol + 1,
          symbol,
          assetClass,
          contractCount,
          message: `Fetching ${contractCount} contracts for ${symbol}`,
        });
      },
    },
  });

  // Sort by annualized return descending
  opportunities.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

  console.log(`=== Scan Complete: ${opportunities.length} total opportunities found ===\n`);

  sseService.broadcast("scanner", {
    status: "completed",
    totalSymbols,
    opportunitiesFound: opportunities.length,
    message: `Scan complete: ${opportunities.length} opportunities found`,
  });

  return opportunities;
}

export default router;
