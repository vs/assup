/**
 * Scanner Jobs API routes
 * Manages background scanner job execution
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { scanJobService } from "../services/scanJob.service.js";
import { ibkrService } from "../services/ibkr.js";
import { sseService } from "../services/sse.js";
import { scanSymbols } from "../services/optionScan.service.js";
import { scannerCriteriaSchema } from "@assup/shared";
import { NotFoundError, IBKRConnectionError } from "../errors/index.js";
import { z } from "zod";
import type { OptionOpportunity } from "@assup/shared";
import { Prisma } from "@prisma/client";

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
 * Execute a scan job.
 * Resolves symbols from positions/watchlists, builds the assignment map,
 * then delegates the actual option scanning to the shared service.
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
  const assignmentWhere: Prisma.SecurityAssignmentWhereInput = {
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

  // Build symbol-to-asset-class map
  const symbolAssignments = new Map(
    filteredSymbols.map((symbol) => {
      const assignment = assignments.find((a) => a.symbol === symbol);
      return [
        symbol,
        assignment
          ? { name: assignment.assetClass.name, color: assignment.assetClass.color }
          : { name: "Unassigned", color: "#6b7280" },
      ] as const;
    })
  );

  // Delegate to shared scan logic
  await scanSymbols({
    symbolAssignments,
    criteria,
    signal,
    callbacks: {
      async onTotalSymbols(count) {
        await progress.setTotalSymbols(count);
      },
      async onSymbolComplete(symbol, assetClass, opportunities) {
        await progress.symbolComplete(symbol, assetClass, opportunities);
      },
    },
  });
}

export default router;
