/**
 * ScanJobService - manages background scanner job execution
 */

import { prisma } from "../db/index.js";
import { sseService } from "./sse.js";
import { ibkrService } from "./ibkr.js";
import type { ScannerCriteria, OptionOpportunity, ScanJob } from "@assup/shared";

// Track running jobs with their abort controllers
const runningJobs = new Map<string, AbortController>();

/**
 * Initialize the service - start cleanup interval
 */
function initScanJobService(): void {
  // Run cleanup every 10 minutes
  setInterval(() => {
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
 * Uses the shared refcount in ibkrService so that scan jobs don't
 * stomp on other consumers (e.g. spread stream) that also need live data.
 */
function acquireMarketDataType(): void {
  if (runningJobs.size === 1) {
    ibkrService.acquireLiveMarketData();
  }
}

function releaseMarketDataType(): void {
  if (runningJobs.size === 0) {
    ibkrService.releaseLiveMarketData();
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
      console.error(`[ScanJob] ${jobId} failed:`, errorMessage);
      try {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: { status: "failed", errorMessage, completedAt: new Date() },
        });
        sseService.broadcast("scanner_job", { type: "failed", jobId, error: errorMessage });
      } catch (updateErr) {
        console.error(`[ScanJob] ${jobId} failed to update status after error:`, updateErr);
      }
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
      // Calculate best stats from new opportunities
      let newBestAnnualReturn: number | null = null;
      let newBestPremiumPct: number | null = null;
      for (const opp of newOpportunities) {
        if (newBestAnnualReturn === null || opp.annualizedReturn > newBestAnnualReturn) {
          newBestAnnualReturn = opp.annualizedReturn;
        }
        if (newBestPremiumPct === null || opp.premiumPercent > newBestPremiumPct) {
          newBestPremiumPct = opp.premiumPercent;
        }
      }

      // Atomic JSON append + stats update to avoid read-modify-write race
      const newOppsJson = JSON.stringify(newOpportunities);
      await prisma.$executeRaw`
        UPDATE scan_jobs SET
          scanned_symbols = scanned_symbols + 1,
          opportunities = CASE
            WHEN opportunities IS NULL OR opportunities = '[]'::jsonb
            THEN ${newOppsJson}::jsonb
            ELSE opportunities || ${newOppsJson}::jsonb
          END,
          opportunity_count = jsonb_array_length(
            CASE
              WHEN opportunities IS NULL OR opportunities = '[]'::jsonb
              THEN ${newOppsJson}::jsonb
              ELSE opportunities || ${newOppsJson}::jsonb
            END
          ),
          best_annual_return = GREATEST(best_annual_return, ${newBestAnnualReturn}),
          best_premium_pct = GREATEST(best_premium_pct, ${newBestPremiumPct})
        WHERE id = ${jobId}::uuid
      `;

      // Broadcast progress with newly found opportunities so the UI can
      // render results incrementally while the scan is still running.
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
          opportunities: newOpportunities,
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
