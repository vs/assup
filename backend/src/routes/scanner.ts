/**
 * Scanner API routes
 * Options scanner for finding opportunities in underinvested asset classes
 */

import { Router } from "express";
import { SecType } from "@stoqey/ib";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { ibkrService, Position as IBPosition } from "../services/ibkr.js";
import { assignmentService, getSecurityKey } from "../services/assignment.service.js";
import { allocationService } from "../services/allocation.service.js";
import { sseService } from "../services/sse.js";
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
        const error = err as { message?: string; code?: string };
        if (!error.message?.includes("does not support positions") && error.code !== "timeout") {
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
    const assignmentWhere: any = {
      symbol: { in: uniqueSymbols },
      secType: "STK",
    };

    // Filter by target asset classes if specified
    if (criteria.targetAssetClasses && criteria.targetAssetClasses.length > 0) {
      assignmentWhere.assetClassId = { in: criteria.targetAssetClasses };
    }

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
    const opportunities = await scanOptionsForSymbols(filteredSymbols, symbolAssignments, criteria);

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
    minStrikePercent: number;
    maxStrikePercent: number;
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
    underlyingPrice?: number;
  }> = [];

  // Create a map for quick lookup of asset class info
  const symbolToAssetClass = new Map(
    symbolAssignments.map((s) => [s.symbol, { name: s.assetClass.name, color: s.assetClass.color }])
  );

  const totalSymbols = symbols.length;
  console.log(`\n=== Starting Options Scan for ${totalSymbols} symbols ===\n`);

  // Check if US stock market is currently open
  // Market hours: 9:30 AM - 4:00 PM ET, Monday-Friday (excluding holidays)
  const isMarketOpen = (): boolean => {
    const now = new Date();
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = etTime.getDay();
    const hours = etTime.getHours();
    const minutes = etTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    // Weekend check (0 = Sunday, 6 = Saturday)
    if (day === 0 || day === 6) return false;

    // Market hours: 9:30 AM (570 min) to 4:00 PM (960 min) ET
    const marketOpen = 9 * 60 + 30;  // 9:30 AM
    const marketClose = 16 * 60;      // 4:00 PM

    return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
  };

  // Use Live data during market hours, Frozen (last close) outside market hours
  const marketOpen = isMarketOpen();
  const marketDataType = marketOpen ? 1 : 2; // 1 = Live, 2 = Frozen
  const marketDataTypeName = marketOpen ? "Live" : "Frozen (last close)";

  try {
    ibkrService.setMarketDataType(marketDataType as 1 | 2);
    console.log(`Market is ${marketOpen ? "OPEN" : "CLOSED"}, using ${marketDataTypeName} data`);
  } catch (err) {
    console.warn(`Could not switch to ${marketDataTypeName} market data, continuing with delayed:`, err);
  }

  // Send initial progress
  sseService.broadcast("scanner", {
    status: "started",
    totalSymbols,
    currentSymbol: 0,
    message: `Starting scan for ${totalSymbols} symbols`,
  });

  try {
    for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const assetClassInfo = symbolToAssetClass.get(symbol);
    if (!assetClassInfo) continue;

    try {
      console.log(`[${i + 1}/${totalSymbols}] Scanning ${symbol} (${assetClassInfo.name})...`);

      // Send progress update
      sseService.broadcast("scanner", {
        status: "scanning",
        totalSymbols,
        currentSymbol: i + 1,
        symbol,
        assetClass: assetClassInfo.name,
        message: `Scanning ${symbol} (${i + 1}/${totalSymbols})`,
      });

      // Get current price of underlying stock
      let underlyingPrice: number | undefined;
      try {
        const stockContract = {
          symbol,
          secType: SecType.STK,
          exchange: "SMART",
          currency: "USD",
        };
        const stockData = await ibkrService.getMarketDataBatch([stockContract]);
        const stockKey = `${symbol}_undefined_undefined_undefined`;
        const stockSnapshot = stockData.get(stockKey);
        if (stockSnapshot?.last) {
          underlyingPrice = stockSnapshot.last;
          console.log(`  ↳ Underlying price: $${underlyingPrice.toFixed(2)}`);
        }
      } catch (err) {
        console.log(`  ↳ Could not fetch underlying price: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Get options chain
      const chain = await ibkrService.getOptionChain(symbol);
      if (chain.length === 0) {
        console.log(`  ↳ No options chain available`);
        continue;
      }

      // Get unique expirations and strikes from chain
      const allExpirations = [...new Set(chain.map(c => c.expiration))].sort();
      const allStrikes = [...new Set(chain.map(c => c.strike))].sort((a, b) => a - b);
      console.log(`  ↳ Found ${allExpirations.length} expirations, ${allStrikes.length} strikes`);

      // Filter by expiration date and reasonable strike range
      const today = new Date();

      // Get unique strikes for logging
      const uniqueStrikes = [...new Set(chain.map(c => c.strike))].sort((a, b) => a - b);

      // Use actual underlying price for strike range calculation
      // Fall back to median strike only if underlying price is unavailable
      const referencePrice = underlyingPrice ?? uniqueStrikes[Math.floor(uniqueStrikes.length / 2)];

      // Filter strikes based on configured percentage range relative to underlying price
      const minStrike = referencePrice * (criteria.minStrikePercent / 100);
      const maxStrike = referencePrice * (criteria.maxStrikePercent / 100);
      console.log(`  ↳ Reference price: $${referencePrice.toFixed(2)}, strike range: $${minStrike.toFixed(0)}-$${maxStrike.toFixed(0)} (${criteria.minStrikePercent}%-${criteria.maxStrikePercent}%)`);

      const filteredChain = chain.filter((entry) => {
        const expirationDate = parseExpirationDate(entry.expiration);
        const daysToExpiry = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const inExpirationRange = daysToExpiry >= criteria.minDaysToExpiry && daysToExpiry <= criteria.maxDaysToExpiry;
        const inStrikeRange = entry.strike >= minStrike && entry.strike <= maxStrike;
        return inExpirationRange && inStrikeRange;
      });

      if (filteredChain.length === 0) {
        console.log(`  ↳ No options in range (${criteria.minDaysToExpiry}-${criteria.maxDaysToExpiry} days, strikes $${minStrike.toFixed(0)}-$${maxStrike.toFixed(0)})`);
        continue;
      }

      // Show what's being evaluated
      const filteredExpirations = [...new Set(filteredChain.map(c => c.expiration))].sort();
      const filteredStrikes = [...new Set(filteredChain.map(c => c.strike))].sort((a, b) => a - b);
      const strikeRange = filteredStrikes.length > 0
        ? `$${filteredStrikes[0]}-$${filteredStrikes[filteredStrikes.length - 1]}`
        : 'none';
      console.log(`  ↳ Evaluating ${filteredExpirations.length} expirations (${filteredExpirations[0]} to ${filteredExpirations[filteredExpirations.length - 1]})`);
      console.log(`  ↳ Strike range: ${strikeRange} (${filteredStrikes.length} strikes, filtered from ${uniqueStrikes.length})`);

      // Collect contracts to get market data for (only put options for cash-secured puts)
      const contracts = filteredChain.map((entry) => entry.put);

      // Send progress update with details
      sseService.broadcast("scanner", {
        status: "fetching",
        totalSymbols,
        currentSymbol: i + 1,
        symbol,
        assetClass: assetClassInfo.name,
        expirations: `${filteredExpirations[0]} to ${filteredExpirations[filteredExpirations.length - 1]}`,
        strikeRange,
        contractCount: contracts.length,
        message: `Fetching ${contracts.length} contracts for ${symbol}`,
      });

      // Get market data for options contracts (NOT the underlying!)
      if (contracts.length > 0) {
        const sample = contracts[0];
        console.log(`  ↳ Sample contract: ${sample.symbol} $${sample.strike} ${sample.lastTradeDateOrContractMonth} ${sample.right} on ${sample.exchange}`);
      }
      console.log(`  ↳ Fetching market data for ${contracts.length} PUT contracts...`);
      const marketDataMap = await ibkrService.getMarketDataBatch(contracts);
      console.log(`  ↳ Received market data for ${marketDataMap.size} contracts`);

      // Debug counters
      let withBidAsk = 0;
      let passedCriteria = 0;
      let failedReturn = 0;
      let failedPremium = 0;

      // Process each option and calculate metrics
      for (const entry of filteredChain) {
        const expirationDate = parseExpirationDate(entry.expiration);
        const daysToExpiry = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Process PUT option (cash-secured put strategy)
        const putKey = `${entry.put.symbol}_${entry.put.lastTradeDateOrContractMonth}_${entry.put.strike}_${entry.put.right}`;
        const putData = marketDataMap.get(putKey);

        if (putData && putData.bid !== undefined && putData.ask !== undefined && putData.bid > 0 && putData.ask > 0) {
          withBidAsk++;
          const midPrice = (putData.bid + putData.ask) / 2;
          const premiumPercent = (midPrice / entry.strike) * 100;
          const annualizedReturn = (premiumPercent * 365) / daysToExpiry;

          // Debug: Log first few samples
          if (withBidAsk <= 3) {
            console.log(`  ↳ Sample: ${symbol} $${entry.strike} ${entry.expiration}: bid=${putData.bid}, ask=${putData.ask}, premium=${premiumPercent.toFixed(2)}%, annual=${annualizedReturn.toFixed(2)}%`);
          }

          // Filter by criteria
          const passesReturn = annualizedReturn >= criteria.minAnnualizedReturn;
          const passesPremium = premiumPercent >= criteria.minPremiumPercent;

          if (!passesReturn) failedReturn++;
          if (!passesPremium) failedPremium++;

          if (passesReturn && passesPremium) {
            passedCriteria++;
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
              delta: putData.delta,
              annualizedReturn,
              premiumPercent,
              underlyingPrice,
            });
          }
        }
      }

      console.log(`  ↳ Market data stats: ${withBidAsk} with valid bid/ask, ${passedCriteria} passed criteria`);
      if (failedReturn > 0 || failedPremium > 0) {
        console.log(`  ↳ Filtered out: ${failedReturn} by annual return (min ${criteria.minAnnualizedReturn}%), ${failedPremium} by premium (min ${criteria.minPremiumPercent}%)`);
      }

      const newOpportunities = opportunities.filter(o => o.symbol === symbol).length;
      console.log(`  ↳ Found ${newOpportunities} qualifying opportunities\n`);
    } catch (err) {
      console.error(`  ↳ Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // Sort by annualized return descending
  opportunities.sort((a, b) => b.annualizedReturn - a.annualizedReturn);

  console.log(`=== Scan Complete: ${opportunities.length} total opportunities found ===\n`);

  // Send completion event
  sseService.broadcast("scanner", {
    status: "completed",
    totalSymbols,
    opportunitiesFound: opportunities.length,
    message: `Scan complete: ${opportunities.length} opportunities found`,
  });

  return opportunities;
  } finally {
    // Always switch back to delayed data after scan completes
    try {
      ibkrService.setMarketDataType(3); // 3 = Delayed
    } catch (err) {
      console.warn("Could not switch back to delayed market data:", err);
    }
  }
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
