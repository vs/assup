import { prisma } from "./db.js";
import { collectionService } from "./collection.service.js";
import { jobService } from "./job.service.js";
import { synthesize, type SynthesizerMode } from "./synthesizer/synthesizer.js";
import { macroService } from "./macro.service.js";
import { ReportProgress } from "./reportProgress.js";

class PipelineService {
  /**
   * Generate a full research report for a ticker.
   * Runs as a background job: collect → analyze → synthesize → store.
   */
  async generateReport(
    symbol: string,
    options: { force?: boolean; model?: "claude-sonnet-4-6" | "claude-opus-4-6"; mode?: SynthesizerMode } = {}
  ): Promise<string> {
    const job = await jobService.create("generate_report", symbol);

    console.log(`[Pipeline] Starting report generation for ${symbol} (job=${job.id}, mode=${options.mode ?? "default"}, model=${options.model ?? "default"}, force=${!!options.force})`);

    // Run pipeline in background (don't await)
    this.runPipeline(job.id, symbol, options).catch((err) => {
      console.error(`[Pipeline] Failed for ${symbol}:`, err);
    });

    return job.id;
  }

  private async runPipeline(
    jobId: string,
    symbol: string,
    options: { force?: boolean; model?: "claude-sonnet-4-6" | "claude-opus-4-6"; mode?: SynthesizerMode }
  ): Promise<void> {
    const pipelineStart = Date.now();
    const progress = new ReportProgress(
      [...collectionService.tickerSources(), "macro"],
      (text, detail) => jobService.updateProgress(jobId, text, detail)
    );
    try {
      await jobService.start(jobId);
      await progress.begin();

      // Step 1: Collect and analyze every source, refreshing macro context alongside
      console.log(`[Pipeline] ${symbol}: collecting data from all sources...`);
      const collectStart = Date.now();
      const [analysisIds] = await Promise.all([
        collectionService.collectAndAnalyzeAll(symbol, {
          force: options.force,
          onProgress: (event) => progress.source(event),
        }),
        this.refreshMacro(symbol, progress),
      ]);
      console.log(`[Pipeline] ${symbol}: collection complete in ${((Date.now() - collectStart) / 1000).toFixed(1)}s — ${analysisIds.length} analyses produced`);

      if (analysisIds.length === 0) {
        console.error(`[Pipeline] ${symbol}: no analysis results — aborting synthesis`);
        await progress.flush();
        await jobService.fail(jobId, "No analysis results produced — all collectors may have failed");
        return;
      }

      // Step 2: Fetch analysis results for synthesizer
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

      await progress.synthesizing();
      const result = await synthesize(synthInput, {
        model: options.model,
        mode: options.mode,
        onPartialText: (text) => progress.partialText(text),
      });

      // Step 5: Store report
      await progress.storing();
      const report = await prisma.researchReport.create({
        data: {
          symbol,
          recommendation: result.recommendation,
          confidence: result.confidence,
          summary: result.summary,
          fullReport: result.fullReport,
          analysisIds,
          companyOverview: result.companyOverview ?? undefined,
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
      // Let queued progress land first so it cannot overwrite the failed state
      progress.dispose();
      await progress.flush();
      try {
        await jobService.fail(jobId, (err as Error).message);
      } catch (failErr) {
        console.error(`[Pipeline] Failed to record job failure for ${jobId}:`, failErr);
      }
    } finally {
      progress.dispose();
    }
  }

  /** Refresh macro context (non-fatal: the report notes when it is missing). */
  private async refreshMacro(symbol: string, progress: ReportProgress): Promise<void> {
    const started = Date.now();
    progress.source({ source: "macro", status: "collecting" });
    try {
      const snapshot = await macroService.collectAndAnalyze();
      progress.source({
        source: "macro",
        status: "done",
        cached: snapshot.analyzedAt.getTime() < started,
        signal: snapshot.regime,
        confidence: snapshot.confidence,
        detail: null,
      });
    } catch (err) {
      const message = (err as Error).message;
      console.warn(`[Pipeline] ${symbol}: macro collection failed (non-fatal): ${message}`);
      progress.source({ source: "macro", status: "failed", detail: message });
    }
  }
}

export const pipelineService = new PipelineService();
