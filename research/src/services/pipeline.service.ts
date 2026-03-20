import { prisma } from "../db/index.js";
import { collectionService } from "./collection.service.js";
import { jobService } from "./job.service.js";
import { synthesize, type SynthesizerMode } from "../synthesizer/synthesizer.js";
import { macroService } from "./macro.service.js";
import { NotFoundError } from "../errors/AppError.js";

class PipelineService {
  /**
   * Generate a full research report for a ticker.
   * Runs as a background job: collect → analyze → synthesize → store.
   */
  async generateReport(
    symbol: string,
    options: { force?: boolean; model?: "claude-sonnet-4-6" | "claude-opus-4-6"; mode?: SynthesizerMode } = {}
  ): Promise<string> {
    const ticker = await prisma.ticker.findUnique({ where: { symbol } });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const job = await jobService.create("generate_report", symbol);

    // Run pipeline in background (don't await)
    this.runPipeline(job.id, ticker.id, symbol, options).catch((err) => {
      console.error(`Pipeline failed for ${symbol}:`, err);
    });

    return job.id;
  }

  private async runPipeline(
    jobId: string,
    tickerId: string,
    symbol: string,
    options: { force?: boolean; model?: "claude-sonnet-4-6" | "claude-opus-4-6"; mode?: SynthesizerMode }
  ): Promise<void> {
    try {
      await jobService.start(jobId);

      // Step 1: Collect and analyze
      await jobService.updateProgress(jobId, "Collecting data from all sources...");
      const analysisIds = await collectionService.collectAndAnalyzeAll(
        tickerId,
        symbol,
        { force: options.force }
      );

      // Step 1.5: Ensure fresh macro context
      await jobService.updateProgress(jobId, "Updating macro context...");
      await macroService.collectAndAnalyze().catch((err) => {
        console.warn(`Macro collection failed (non-fatal): ${(err as Error).message}`);
      });

      if (analysisIds.length === 0) {
        await jobService.fail(jobId, "No analysis results produced — all collectors may have failed");
        return;
      }

      // Step 2: Fetch analysis results for synthesizer
      await jobService.updateProgress(jobId, "Synthesizing report with AI...");
      const analyses = await prisma.analysis.findMany({
        where: { id: { in: analysisIds } },
      });

      // Step 3: Fetch latest macro context (if available)
      const macroSnapshot = await prisma.macroSnapshot.findFirst({
        orderBy: { analyzedAt: "desc" },
      });

      // Step 4: Synthesize
      const synthInput = {
        symbol,
        analyses: analyses.map((a) => ({
          source: a.source,
          signal: a.signal,
          confidence: a.confidence,
          summary: a.summary,
          details: a.details as Record<string, unknown>,
        })),
        macroContext: macroSnapshot
          ? {
              regime: macroSnapshot.regime,
              summary: macroSnapshot.summary,
              details: macroSnapshot.details as Record<string, unknown>,
            }
          : undefined,
      };

      const result = await synthesize(synthInput, {
        model: options.model,
        mode: options.mode,
      });

      // Step 5: Store report
      await jobService.updateProgress(jobId, "Storing report...");
      const report = await prisma.report.create({
        data: {
          tickerId,
          recommendation: result.recommendation,
          confidence: result.confidence,
          summary: result.summary,
          fullReport: result.fullReport,
          analysisIds,
        },
      });

      await jobService.complete(jobId, {
        reportId: report.id,
        recommendation: result.recommendation,
        confidence: result.confidence,
      });
    } catch (err) {
      try {
        await jobService.fail(jobId, (err as Error).message);
      } catch (failErr) {
        console.error(`Failed to record job failure for ${jobId}:`, failErr);
      }
    }
  }
}

export const pipelineService = new PipelineService();
