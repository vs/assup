import cron from "node-cron";
import { prisma } from "../db/index.js";
import { collectionService } from "./collection.service.js";
import { macroService } from "./macro.service.js";
import { pipelineService } from "./pipeline.service.js";

const DAILY_SOURCES = [
  "technical",
  "options",
  "events",
  "seeking_alpha",
  "sec_filings",
  "analyst_consensus",
];

async function processBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(fn));
  }
}

class SchedulerService {
  private jobs: cron.ScheduledTask[] = [];

  /**
   * Start all scheduled cron jobs.
   * The caller should check SCHEDULER_ENABLED before calling this.
   */
  start(): void {
    console.log("[Scheduler] Starting scheduled jobs...");

    // Daily after close: 6 PM ET weekdays
    this.jobs.push(
      cron.schedule("0 18 * * 1-5", () => {
        this.runDailyCollection().catch((err) => {
          console.error("[Scheduler] Daily collection top-level error:", err);
        });
      }, { timezone: "America/New_York" })
    );

    // Bi-weekly short interest: 1st and 15th at 6 PM ET
    this.jobs.push(
      cron.schedule("0 18 1,15 * *", () => {
        this.runShortInterestCollection().catch((err) => {
          console.error("[Scheduler] Short interest collection top-level error:", err);
        });
      }, { timezone: "America/New_York" })
    );

    // Social sentiment: every 6 hours on weekdays
    this.jobs.push(
      cron.schedule("0 */6 * * 1-5", () => {
        this.runSocialCollection().catch((err) => {
          console.error("[Scheduler] Social collection top-level error:", err);
        });
      }, { timezone: "America/New_York" })
    );

    // Daily report generation: 6:30 PM ET weekdays
    this.jobs.push(
      cron.schedule("30 18 * * 1-5", () => {
        this.runReportGeneration().catch((err) => {
          console.error("[Scheduler] Report generation top-level error:", err);
        });
      }, { timezone: "America/New_York" })
    );

    console.log("[Scheduler] All jobs scheduled.");
  }

  /**
   * Stop all scheduled cron jobs.
   */
  stop(): void {
    console.log("[Scheduler] Stopping all jobs...");
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    console.log("[Scheduler] All jobs stopped.");
  }

  /**
   * Placeholder for screener schedule integration (Task 6).
   */
  async refreshScreenerSchedules(): Promise<void> {
    // Will be implemented in Task 6
  }

  /**
   * Daily collection: macro data + all core sources for every active ticker.
   * Runs at 6 PM ET on weekdays.
   */
  private async runDailyCollection(): Promise<void> {
    const startTime = Date.now();
    console.log("[Scheduler] Starting daily collection...");

    const tickers = await prisma.ticker.findMany({
      where: { status: "active" },
      select: { id: true, symbol: true },
    });

    console.log(`[Scheduler] Found ${tickers.length} active tickers.`);

    // Collect macro data first (non-fatal)
    try {
      await macroService.collectAndAnalyze();
      console.log("[Scheduler] Macro collection complete.");
    } catch (err) {
      console.error("[Scheduler] Macro collection failed (non-fatal):", (err as Error).message);
    }

    // Process tickers in batches of 5
    await processBatched(tickers, 5, async (ticker) => {
      try {
        await collectionService.collectAndAnalyzeAll(ticker.id, ticker.symbol, {
          sources: DAILY_SOURCES,
        });
        console.log(`[Scheduler] Daily collection complete for ${ticker.symbol}`);
      } catch (err) {
        console.error(
          `[Scheduler] Daily collection failed for ${ticker.symbol}:`,
          (err as Error).message
        );
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scheduler] Daily collection finished in ${elapsed}s.`);
  }

  /**
   * Bi-weekly short interest collection for all active tickers.
   * Runs on the 1st and 15th of each month at 6 PM ET.
   */
  private async runShortInterestCollection(): Promise<void> {
    const startTime = Date.now();
    console.log("[Scheduler] Starting short interest collection...");

    const tickers = await prisma.ticker.findMany({
      where: { status: "active" },
      select: { id: true, symbol: true },
    });

    console.log(`[Scheduler] Found ${tickers.length} active tickers for short interest.`);

    await processBatched(tickers, 5, async (ticker) => {
      try {
        await collectionService.collectSource(ticker.id, ticker.symbol, "short_interest");
        await collectionService.analyzeSource(ticker.id, "short_interest");
        console.log(`[Scheduler] Short interest complete for ${ticker.symbol}`);
      } catch (err) {
        console.error(
          `[Scheduler] Short interest failed for ${ticker.symbol}:`,
          (err as Error).message
        );
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scheduler] Short interest collection finished in ${elapsed}s.`);
  }

  /**
   * Social sentiment collection for all active tickers.
   * Runs every 6 hours on weekdays.
   */
  private async runSocialCollection(): Promise<void> {
    const startTime = Date.now();
    console.log("[Scheduler] Starting social sentiment collection...");

    const tickers = await prisma.ticker.findMany({
      where: { status: "active" },
      select: { id: true, symbol: true },
    });

    console.log(`[Scheduler] Found ${tickers.length} active tickers for social sentiment.`);

    await processBatched(tickers, 5, async (ticker) => {
      try {
        await collectionService.collectSource(ticker.id, ticker.symbol, "social");
        await collectionService.analyzeSource(ticker.id, "social");
        console.log(`[Scheduler] Social sentiment complete for ${ticker.symbol}`);
      } catch (err) {
        console.error(
          `[Scheduler] Social sentiment failed for ${ticker.symbol}:`,
          (err as Error).message
        );
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scheduler] Social sentiment collection finished in ${elapsed}s.`);
  }

  /**
   * Generate reports for tickers whose analyses are newer than their latest report.
   * Runs at 6:30 PM ET on weekdays.
   */
  private async runReportGeneration(): Promise<void> {
    const startTime = Date.now();
    console.log("[Scheduler] Starting report generation...");

    const tickers = await prisma.ticker.findMany({
      where: { status: "active" },
      select: { id: true, symbol: true, lastAnalyzed: true },
    });

    // Find tickers that need a new report
    const tickersNeedingReports: { id: string; symbol: string }[] = [];

    for (const ticker of tickers) {
      if (!ticker.lastAnalyzed) continue;

      const latestReport = await prisma.report.findFirst({
        where: { tickerId: ticker.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      // Generate report if no report exists or analyses are newer
      if (!latestReport || ticker.lastAnalyzed > latestReport.createdAt) {
        tickersNeedingReports.push({ id: ticker.id, symbol: ticker.symbol });
      }
    }

    console.log(
      `[Scheduler] ${tickersNeedingReports.length} tickers need report generation.`
    );

    // Process in batches of 3 (report generation is heavier)
    await processBatched(tickersNeedingReports, 3, async (ticker) => {
      try {
        const jobId = await pipelineService.generateReport(ticker.symbol);
        console.log(
          `[Scheduler] Report generation started for ${ticker.symbol} (job: ${jobId})`
        );
      } catch (err) {
        console.error(
          `[Scheduler] Report generation failed for ${ticker.symbol}:`,
          (err as Error).message
        );
      }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scheduler] Report generation finished in ${elapsed}s.`);
  }
}

export const schedulerService = new SchedulerService();
