/**
 * ScanJobService - manages background scanner job execution
 */

import { prisma } from "../db/index.js";
import { sseService } from "./sse.js";
import { ibkrService } from "./ibkr.js";
import type { ScannerCriteria, OptionOpportunity, ScanJob } from "@assup/shared";
import { isMarketOpen } from "../utils/index.js";

// Track running jobs with their abort controllers
const runningJobs = new Map<string, AbortController>();

// Cleanup interval handle
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the service - start cleanup interval
 */
function initScanJobService(): void {
  // Run cleanup every 10 minutes
  cleanupInterval = setInterval(() => {
    cleanupExpiredJobs().catch(console.error);
  }, 10 * 60 * 1000);

  // Also mark any stale "running" jobs as failed on startup
  markStaleJobsAsFailed().catch(console.error);
}

/**
 * Mark jobs left in "running" state as failed (server restart scenario)
 */
async function markStaleJobsAsFailed(): Promise<void> {
  const result = await prisma.scanJob.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      errorMessage: "Server restarted during scan",
      completedAt: new Date(),
    },
  });
  if (result.count > 0) {
    console.log(`Marked ${result.count} stale running jobs as failed`);
  }
}

/**
 * Create a new scan job (does not start execution)
 */
async function createJob(
  criteria: ScannerCriteria,
  presetId?: string,
  presetName?: string
): Promise<ScanJob> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  const job = await prisma.scanJob.create({
    data: {
      presetId: presetId || null,
      presetName: presetName || "Custom Scan",
      criteria: criteria as any,
      status: "running",
      totalSymbols: 0,
      scannedSymbols: 0,
      opportunityCount: 0,
      opportunities: [],
      expiresAt,
    },
  });

  return mapPrismaJobToScanJob(job);
}

/**
 * Manage market data type based on running job count.
 * Switch to live/frozen when first job starts, back to delayed when last job ends.
 */
function acquireMarketDataType(): void {
  if (runningJobs.size === 1) {
    try {
      const marketDataType = isMarketOpen() ? 1 : 2;
      ibkrService.setMarketDataType(marketDataType as 1 | 2);
    } catch (err) {
      console.warn("Could not switch market data type:", err);
    }
  }
}

function releaseMarketDataType(): void {
  if (runningJobs.size === 0) {
    try {
      ibkrService.setMarketDataType(3);
    } catch (err) {
      console.warn("Could not switch back to delayed market data:", err);
    }
  }
}

/**
 * Start job execution (call after createJob)
 */
function startJobExecution(
  jobId: string,
  executeFn: (signal: AbortSignal, updateProgress: ProgressUpdater) => Promise<void>
): void {
  const abortController = new AbortController();
  runningJobs.set(jobId, abortController);
  acquireMarketDataType();

  // Execute asynchronously
  executeFn(abortController.signal, createProgressUpdater(jobId))
    .then(async () => {
      runningJobs.delete(jobId);
      releaseMarketDataType();
      // Mark complete if not already cancelled
      const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
      if (job && job.status === "running") {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: { status: "completed", completedAt: new Date() },
        });
        const updatedJob = await getJob(jobId);
        if (updatedJob) {
          sseService.broadcast("scanner_job", { type: "completed", job: updatedJob });
        }
      }
    })
    .catch(async (err) => {
      runningJobs.delete(jobId);
      releaseMarketDataType();
      const errorMessage = err instanceof Error ? err.message : String(err);
      await prisma.scanJob.update({
        where: { id: jobId },
        data: { status: "failed", errorMessage, completedAt: new Date() },
      });
      sseService.broadcast("scanner_job", { type: "failed", jobId, error: errorMessage });
    });
}

/**
 * Progress updater interface
 */
interface ProgressUpdater {
  setTotalSymbols(total: number): Promise<void>;
  symbolComplete(
    symbol: string,
    assetClass: string,
    opportunities: OptionOpportunity[]
  ): Promise<void>;
}

/**
 * Create a progress updater for a job
 */
function createProgressUpdater(jobId: string): ProgressUpdater {
  return {
    async setTotalSymbols(total: number) {
      await prisma.scanJob.update({
        where: { id: jobId },
        data: { totalSymbols: total },
      });
    },

    async symbolComplete(symbol: string, assetClass: string, newOpportunities: OptionOpportunity[]) {
      // Fetch current job state
      const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
      if (!job) return;

      const existingOpportunities = (job.opportunities as unknown as OptionOpportunity[]) || [];
      const allOpportunities = [...existingOpportunities, ...newOpportunities];

      // Calculate best stats
      let bestAnnualReturn = job.bestAnnualReturn;
      let bestPremiumPct = job.bestPremiumPct;
      for (const opp of newOpportunities) {
        if (!bestAnnualReturn || opp.annualizedReturn > bestAnnualReturn) {
          bestAnnualReturn = opp.annualizedReturn;
        }
        if (!bestPremiumPct || opp.premiumPercent > bestPremiumPct) {
          bestPremiumPct = opp.premiumPercent;
        }
      }

      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          scannedSymbols: { increment: 1 },
          opportunityCount: allOpportunities.length,
          bestAnnualReturn,
          bestPremiumPct,
          opportunities: allOpportunities as any,
        },
      });

      // Broadcast progress
      const updatedJob = await prisma.scanJob.findUnique({ where: { id: jobId } });
      if (updatedJob) {
        sseService.broadcast("scanner_job", {
          type: "progress",
          jobId,
          scannedSymbols: updatedJob.scannedSymbols,
          totalSymbols: updatedJob.totalSymbols,
          opportunityCount: updatedJob.opportunityCount,
          symbol,
          assetClass,
        });
      }
    },
  };
}

/**
 * Cancel a running job
 */
async function cancelJob(jobId: string): Promise<ScanJob | null> {
  const controller = runningJobs.get(jobId);
  if (controller) {
    controller.abort();
    runningJobs.delete(jobId);
    releaseMarketDataType();
  }

  const job = await prisma.scanJob.update({
    where: { id: jobId },
    data: { status: "cancelled", completedAt: new Date() },
  });

  const result = mapPrismaJobToScanJob(job);
  sseService.broadcast("scanner_job", { type: "cancelled", job: result });
  return result;
}

/**
 * Get a single job by ID
 */
async function getJob(jobId: string): Promise<ScanJob | null> {
  const job = await prisma.scanJob.findUnique({ where: { id: jobId } });
  return job ? mapPrismaJobToScanJob(job) : null;
}

/**
 * Get all non-expired jobs
 */
async function getJobs(): Promise<ScanJob[]> {
  // Clean up expired jobs first
  await prisma.scanJob.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  const jobs = await prisma.scanJob.findMany({
    orderBy: { startedAt: "desc" },
  });

  return jobs.map(mapPrismaJobToScanJob);
}

/**
 * Delete a job manually
 */
async function deleteJob(jobId: string): Promise<void> {
  // Cancel if running
  const controller = runningJobs.get(jobId);
  if (controller) {
    controller.abort();
    runningJobs.delete(jobId);
    releaseMarketDataType();
  }

  await prisma.scanJob.delete({ where: { id: jobId } });
}

/**
 * Cleanup expired jobs
 */
async function cleanupExpiredJobs(): Promise<number> {
  const result = await prisma.scanJob.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    console.log(`Cleaned up ${result.count} expired scan jobs`);
  }
  return result.count;
}

/**
 * Map Prisma ScanJob to shared ScanJob type
 */
function mapPrismaJobToScanJob(job: any): ScanJob {
  return {
    id: job.id,
    presetId: job.presetId,
    presetName: job.presetName,
    criteria: job.criteria as ScannerCriteria,
    status: job.status,
    totalSymbols: job.totalSymbols,
    scannedSymbols: job.scannedSymbols,
    opportunityCount: job.opportunityCount,
    bestAnnualReturn: job.bestAnnualReturn,
    bestPremiumPct: job.bestPremiumPct,
    opportunities: (job.opportunities || []) as OptionOpportunity[],
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() || null,
    expiresAt: job.expiresAt.toISOString(),
    errorMessage: job.errorMessage,
  };
}

export const scanJobService = {
  init: initScanJobService,
  createJob,
  startJobExecution,
  cancelJob,
  getJob,
  getJobs,
  deleteJob,
  cleanupExpiredJobs,
};
