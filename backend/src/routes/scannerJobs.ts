/**
 * Scanner Jobs API routes
 * Manages background scanner job execution
 */

import { Router } from "express";
import { SecType } from "@stoqey/ib";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { scanJobService } from "../services/scanJob.service.js";
import { ibkrService } from "../services/ibkr.js";
import { sseService } from "../services/sse.js";
import { scannerCriteriaSchema } from "@assup/shared";
import { NotFoundError, IBKRConnectionError } from "../errors/index.js";
import { z } from "zod";
import type { OptionOpportunity } from "@assup/shared";

const router = Router();

// Schema for job creation
const createJobSchema = z.object({
  presetId: z.string().uuid().optional(),
  criteria: scannerCriteriaSchema,
});

// Schema for job ID param
const jobIdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * GET /api/scanner/jobs
 * List all non-expired scan jobs
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const jobs = await scanJobService.getJobs();
    res.json(jobs);
  })
);

/**
 * GET /api/scanner/jobs/:id
 * Get a single job with full results
 */
router.get(
  "/:id",
  validate({ params: jobIdParamSchema }),
  asyncHandler(async (req, res) => {
    const job = await scanJobService.getJob(req.params.id);
    if (!job) {
      throw new NotFoundError("Scan job not found");
    }
    res.json(job);
  })
);

/**
 * POST /api/scanner/jobs
 * Create and start a new scan job
 */
router.post(
  "/",
  validate({ body: createJobSchema }),
  asyncHandler(async (req, res) => {
    const { presetId, criteria } = req.body;

    if (!ibkrService.isConnected()) {
      throw new IBKRConnectionError();
    }

    // Get preset name if presetId provided
    let presetName = "Custom Scan";
    if (presetId) {
      const preset = await prisma.scannerPreset.findUnique({
        where: { id: presetId },
        select: { name: true },
      });
      if (preset) {
        presetName = preset.name;
      }
    }

    // Create the job record
    const job = await scanJobService.createJob(criteria, presetId, presetName);

    // Broadcast job created
    sseService.broadcast("scanner_job", { type: "created", job });

    // Start execution in background
    scanJobService.startJobExecution(job.id, async (signal, progress) => {
      await executeJobScan(job.id, criteria, signal, progress);
    });

    res.status(201).json(job);
  })
);

/**
 * POST /api/scanner/jobs/:id/cancel
 * Cancel a running job
 */
router.post(
  "/:id/cancel",
  validate({ params: jobIdParamSchema }),
  asyncHandler(async (req, res) => {
    const job = await scanJobService.cancelJob(req.params.id);
    if (!job) {
      throw new NotFoundError("Scan job not found");
    }
    res.json(job);
  })
);

/**
 * DELETE /api/scanner/jobs/:id
 * Delete a job (stops it if running)
 */
router.delete(
  "/:id",
  validate({ params: jobIdParamSchema }),
  asyncHandler(async (req, res) => {
    await scanJobService.deleteJob(req.params.id);
    res.status(204).send();
  })
);

/**
 * Execute a scan job - extracted scan logic
 */
async function executeJobScan(
  jobId: string,
  criteria: z.infer<typeof scannerCriteriaSchema>,
  signal: AbortSignal,
  progress: { setTotalSymbols: (n: number) => Promise<void>; symbolComplete: (s: string, ac: string, opps: OptionOpportunity[]) => Promise<void> }
): Promise<void> {
  // Collect symbols from positions and watchlists
  let uniqueSymbols: string[];

  if (criteria.specificSymbol) {
    uniqueSymbols = [criteria.specificSymbol.toUpperCase()];
  } else {
    const symbolsSet = new Set<string>();

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

    const watchlistItems = await prisma.watchlistItem.findMany({
      where: { secType: "STK" },
      select: { symbol: true },
    });
    watchlistItems.forEach((item) => symbolsSet.add(item.symbol));

    uniqueSymbols = Array.from(symbolsSet);
  }

  if (uniqueSymbols.length === 0) {
    return;
  }

  // Get asset class assignments
  const assignmentWhere: any = {
    symbol: { in: uniqueSymbols },
    secType: "STK",
  };

  if (criteria.targetAssetClasses && criteria.targetAssetClasses.length > 0) {
    assignmentWhere.assetClassId = { in: criteria.targetAssetClasses };
  }

  const assignments = await prisma.securityAssignment.findMany({
    where: assignmentWhere,
    include: { assetClass: true },
  });

  const filteredSymbols =
    criteria.targetAssetClasses && criteria.targetAssetClasses.length > 0
      ? assignments.map((a) => a.symbol)
      : uniqueSymbols;

  if (filteredSymbols.length === 0) {
    return;
  }

  // Set total symbols count
  await progress.setTotalSymbols(filteredSymbols.length);

  // Create symbol to asset class mapping
  const symbolToAssetClass = new Map(
    filteredSymbols.map((symbol) => {
      const assignment = assignments.find((a) => a.symbol === symbol);
      return [
        symbol,
        assignment
          ? { name: assignment.assetClass.name, color: assignment.assetClass.color }
          : { name: "Unassigned", color: "#6b7280" },
      ];
    })
  );

  // Check market hours for data type
  const isMarketOpen = (): boolean => {
    const now = new Date();
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = etTime.getDay();
    const hours = etTime.getHours();
    const minutes = etTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    if (day === 0 || day === 6) return false;
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
  };

  const marketDataType = isMarketOpen() ? 1 : 2;
  try {
    ibkrService.setMarketDataType(marketDataType as 1 | 2);
  } catch (err) {
    console.warn("Could not switch market data type:", err);
  }

  try {
    for (const symbol of filteredSymbols) {
      // Check for cancellation
      if (signal.aborted) {
        break;
      }

      const assetClassInfo = symbolToAssetClass.get(symbol);
      if (!assetClassInfo) continue;

      const opportunities: OptionOpportunity[] = [];

      try {
        // Get underlying price
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
          }
        } catch (err) {
          // Continue without underlying price
        }

        // Get options chain
        const chain = await ibkrService.getOptionChain(symbol);
        if (chain.length === 0) {
          await progress.symbolComplete(symbol, assetClassInfo.name, []);
          continue;
        }

        const today = new Date();
        const uniqueStrikes = [...new Set(chain.map((c) => c.strike))].sort((a, b) => a - b);
        const referencePrice = underlyingPrice ?? uniqueStrikes[Math.floor(uniqueStrikes.length / 2)];

        const optionTypes = criteria.optionTypes || "PUT";
        const scanPuts = optionTypes === "PUT" || optionTypes === "BOTH";
        const scanCalls = optionTypes === "CALL" || optionTypes === "BOTH";

        const putMinStrike = referencePrice * (criteria.putMinStrikePercent / 100);
        const putMaxStrike = referencePrice * (criteria.putMaxStrikePercent / 100);
        const callMinStrike = referencePrice * (criteria.callMinStrikePercent / 100);
        const callMaxStrike = referencePrice * (criteria.callMaxStrikePercent / 100);

        // Filter by expiration
        const expirationFilteredChain = chain.filter((entry) => {
          const expirationDate = parseExpirationDate(entry.expiration);
          const daysToExpiry = Math.floor(
            (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );
          return daysToExpiry >= criteria.minDaysToExpiry && daysToExpiry <= criteria.maxDaysToExpiry;
        });

        if (expirationFilteredChain.length === 0) {
          await progress.symbolComplete(symbol, assetClassInfo.name, []);
          continue;
        }

        // Filter by strike ranges
        const putFilteredChain = scanPuts
          ? expirationFilteredChain.filter((e) => e.strike >= putMinStrike && e.strike <= putMaxStrike)
          : [];
        const callFilteredChain = scanCalls
          ? expirationFilteredChain.filter((e) => e.strike >= callMinStrike && e.strike <= callMaxStrike)
          : [];

        if (putFilteredChain.length === 0 && callFilteredChain.length === 0) {
          await progress.symbolComplete(symbol, assetClassInfo.name, []);
          continue;
        }

        // Collect contracts
        const contracts: typeof chain[0]["put"][] = [];
        if (scanPuts) contracts.push(...putFilteredChain.map((e) => e.put));
        if (scanCalls) contracts.push(...callFilteredChain.map((e) => e.call));

        // Get market data
        const marketDataMap = await ibkrService.getMarketDataBatch(contracts);

        // Process options
        const processOption = (
          entry: typeof chain[0],
          optionType: "PUT" | "CALL",
          contract: typeof chain[0]["put"],
          daysToExpiry: number
        ) => {
          const key = `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
          const data = marketDataMap.get(key);

          if (data && data.bid !== undefined && data.ask !== undefined && data.bid > 0 && data.ask > 0) {
            const midPrice = (data.bid + data.ask) / 2;
            const premiumPercent = (midPrice / entry.strike) * 100;
            const annualizedReturn = (premiumPercent * 365) / daysToExpiry;

            const passesReturn = annualizedReturn >= criteria.minAnnualizedReturn;
            const passesPremium = premiumPercent >= criteria.minPremiumPercent;

            let absDelta: number | null = null;
            if (data.delta !== undefined) {
              absDelta = Math.abs(data.delta);
            } else if (underlyingPrice && underlyingPrice > 0) {
              const moneyness = entry.strike / underlyingPrice;
              if (optionType === "PUT") {
                absDelta = Math.abs(Math.max(-0.95, Math.min(-0.05, -0.5 - (moneyness - 1) * 2)));
              } else {
                absDelta = Math.max(0.05, Math.min(0.95, 0.5 - (moneyness - 1) * 2));
              }
            }
            const passesDelta =
              absDelta === null || (absDelta >= criteria.minDelta && absDelta <= criteria.maxDelta);

            if (passesReturn && passesPremium && passesDelta) {
              opportunities.push({
                symbol,
                assetClassName: assetClassInfo.name,
                assetClassColor: assetClassInfo.color,
                strike: entry.strike,
                expiration: entry.expiration,
                daysToExpiry,
                optionType,
                bid: data.bid,
                ask: data.ask,
                midPrice,
                delta: data.delta,
                annualizedReturn,
                premiumPercent,
                underlyingPrice,
              });
            }
          }
        };

        if (scanPuts) {
          for (const entry of putFilteredChain) {
            const expirationDate = parseExpirationDate(entry.expiration);
            const daysToExpiry = Math.floor(
              (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            );
            processOption(entry, "PUT", entry.put, daysToExpiry);
          }
        }

        if (scanCalls) {
          for (const entry of callFilteredChain) {
            const expirationDate = parseExpirationDate(entry.expiration);
            const daysToExpiry = Math.floor(
              (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
            );
            processOption(entry, "CALL", entry.call, daysToExpiry);
          }
        }
      } catch (err) {
        console.error(`Error scanning ${symbol}:`, err);
      }

      await progress.symbolComplete(symbol, assetClassInfo.name, opportunities);
    }
  } finally {
    // Switch back to delayed data
    try {
      ibkrService.setMarketDataType(3);
    } catch (err) {
      console.warn("Could not switch back to delayed market data:", err);
    }
  }
}

function parseExpirationDate(expiration: string): Date {
  let year: number, month: number, day: number;

  if (expiration.length === 8) {
    year = parseInt(expiration.substring(0, 4), 10);
    month = parseInt(expiration.substring(4, 6), 10) - 1;
    day = parseInt(expiration.substring(6, 8), 10);
  } else if (expiration.length === 6) {
    year = 2000 + parseInt(expiration.substring(0, 2), 10);
    month = parseInt(expiration.substring(2, 4), 10) - 1;
    day = parseInt(expiration.substring(4, 6), 10);
  } else {
    throw new Error(`Invalid expiration format: ${expiration}`);
  }

  return new Date(year, month, day);
}

export default router;
