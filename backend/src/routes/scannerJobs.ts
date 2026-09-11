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
import { resolveSymbolAssignments } from "../services/scannerSymbols.service.js";

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

    // Get preset name if presetId provided, otherwise build from criteria
    let presetName: string | undefined;
    if (presetId) {
      const preset = await prisma.scannerPreset.findUnique({
        where: { id: presetId },
        select: { name: true },
      });
      if (preset) {
        presetName = preset.name;
      }
    }
    if (!presetName) {
      presetName = buildScanLabel(criteria);
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
  const resolved = await resolveSymbolAssignments({
    specificSymbol: criteria.specificSymbol,
    targetAssetClasses: criteria.targetAssetClasses,
  });

  if (resolved.length === 0) {
    return;
  }

  const symbolAssignments = new Map(
    resolved.map((r) => [r.symbol, r.assetClass] as const)
  );

  // Delegate to shared scan logic
  const { failures } = await scanSymbols({
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

  // A scan where nothing could be reached is a failed job, not an empty result.
  // Reporting "0 opportunities" would hide a TWS outage behind a normal-looking
  // completed job.
  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.symbol} — ${f.error}`).join("; ");
    if (failures.length === symbolAssignments.size) {
      throw new Error(`Scan failed for all ${failures.length} symbol(s): ${detail}`);
    }
    console.error(`[ScanJob ${jobId}] partial failure: ${detail}`);
  }
}

/**
 * Build a human-readable label from scan criteria.
 * e.g. "PUT δ0.15–0.40 7–45d" or "AAPL CALL δ0.20–0.50 14–60d"
 */
function buildScanLabel(criteria: z.infer<typeof scannerCriteriaSchema>): string {
  const parts: string[] = [];
  if (criteria.specificSymbol) {
    parts.push(criteria.specificSymbol.toUpperCase());
  }
  parts.push(criteria.optionTypes);
  parts.push(`δ${criteria.minDelta}–${criteria.maxDelta}`);
  parts.push(`${criteria.minDaysToExpiry}–${criteria.maxDaysToExpiry}d`);
  if (criteria.minAnnualizedReturn > 0) {
    parts.push(`≥${criteria.minAnnualizedReturn}%`);
  }
  return parts.join(" ");
}

export default router;
