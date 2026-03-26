import { prisma } from "./db.js";
import { collectionService } from "./collection.service.js";
import { jobService } from "./job.service.js";
import { synthesize, type SynthesizerMode } from "./synthesizer/synthesizer.js";
import { macroService } from "./macro.service.js";
import { NotFoundError } from "./errors/AppError.js";

class PipelineService {
  /**
   * Generate a full research report for a ticker.
   * Runs as a background job: collect → analyze → synthesize → store.
   */
  async generateReport(
    symbol: string,
    options: { force?: boolean; model?: "claude-sonnet-4-6" | "claude-opus-4-6"; mode?: SynthesizerMode } = {}
  ): Promise<string> {
    const ticker = await prisma.researchTicker.findUnique({ where: { symbol } });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const job = await jobService.create("generate_report", symbol);

    console.log(`[Pipeline] Starting report generation for ${symbol} (job=${job.id}, mode=${options.mode ?? "default"}, model=${options.model ?? "default"}, force=${!!options.force})`);

    // Run pipeline in background (don't await)
    this.runPipeline(job.id, ticker.id, symbol, options).catch((err) => {
      console.error(`[Pipeline] Failed for ${symbol}:`, err);
    });

    return job.id;
  }

  private async runPipeline(
    jobId: string,
    tickerId: string,
    symbol: string,
    options: { force?: boolean; model?: "claude-sonnet-4-6" | "claude-opus-4-6"; mode?: SynthesizerMode }
  ): Promise<void> {
    const pipelineStart = Date.now();
    try {
      await jobService.start(jobId);

      // Step 1: Collect and analyze
      await jobService.updateProgress(jobId, "Collecting data from all sources...");
      console.log(`[Pipeline] ${symbol}: collecting data from all sources...`);
      const collectStart = Date.now();
      const analysisIds = await collectionService.collectAndAnalyzeAll(
        tickerId,
        symbol,
        { force: options.force }
      );
      console.log(`[Pipeline] ${symbol}: collection complete in ${((Date.now() - collectStart) / 1000).toFixed(1)}s — ${analysisIds.length} analyses produced`);

      // Step 1.5: Ensure fresh macro context
      await jobService.updateProgress(jobId, "Updating macro context...");
      await macroService.collectAndAnalyze().catch((err) => {
        console.warn(`[Pipeline] ${symbol}: macro collection failed (non-fatal): ${(err as Error).message}`);
      });

      if (analysisIds.length === 0) {
        console.error(`[Pipeline] ${symbol}: no analysis results — aborting synthesis`);
        await jobService.fail(jobId, "No analysis results produced — all collectors may have failed");
        return;
      }

      // Step 2: Fetch analysis results for synthesizer
      await jobService.updateProgress(jobId, "Synthesizing report with AI...");
      const analyses = await prisma.analysis.findMany({
        where: { id: { in: analysisIds } },
      });
      console.log(`[Pipeline] ${symbol}: synthesizing from ${analyses.length} analyses (sources: ${analyses.map((a) => a.source).join(", ")})`);

      // Step 3: Fetch latest macro context (if available)
      const macroSnapshot = await prisma.macroSnapshot.findFirst({
        orderBy: { analyzedAt: "desc" },
      });
      if (macroSnapshot) {
        console.log(`[Pipeline] ${symbol}: including macro context (regime=${macroSnapshot.regime})`);
      }

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
      const report = await prisma.researchReport.create({
        data: {
          tickerId,
          recommendation: result.recommendation,
          confidence: result.confidence,
          summary: result.summary,
          fullReport: result.fullReport,
          analysisIds,
        },
      });

      const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
      console.log(`[Pipeline] ${symbol}: complete in ${totalElapsed}s — ${result.recommendation} (confidence=${result.confidence}, reportId=${report.id})`);

      await jobService.complete(jobId, {
        reportId: report.id,
        recommendation: result.recommendation,
        confidence: result.confidence,
      });
    } catch (err) {
      const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
      console.error(`[Pipeline] ${symbol}: failed after ${totalElapsed}s:`, (err as Error).message);
      try {
        await jobService.fail(jobId, (err as Error).message);
      } catch (failErr) {
        console.error(`[Pipeline] Failed to record job failure for ${jobId}:`, failErr);
      }
    }
  }
}

export const pipelineService = new PipelineService();
