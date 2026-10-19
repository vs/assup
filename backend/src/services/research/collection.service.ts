import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { getCollector, getAllCollectors } from "./collectors/registry.js";
import { getAnalyzer } from "./analyzers/registry.js";
import { isSkipped } from "./collectors/types.js";
import { withTimeout } from "../../utils/withTimeout.js";
import type { ResearchSourceProgress } from "@assup/shared";

/** One step of a source's progress through collectAndAnalyzeAll. */
export type SourceProgressEvent = Omit<ResearchSourceProgress, "startedAt" | "finishedAt">;

type CollectOutcome =
  | { kind: "cached" }
  | { kind: "collected" }
  | { kind: "skipped"; reason: string };

// Prisma's DbNull representation for writing explicit null to JSON columns
const DbNull = "DbNull" as unknown as Prisma.NullTypes.DbNull;

/**
 * Deadline for a single collector. Without it a collector that never settles
 * (an upstream fetch with no timeout, or a request starved behind a rate-limit
 * queue) leaves the whole pipeline parked on "Collecting data from all
 * sources..." forever, with the job stuck in `running` and no error to show.
 */
function collectorTimeoutMs(): number {
  return Number(process.env.RESEARCH_COLLECTOR_TIMEOUT_MS ?? 120_000);
}

class CollectionService {
  /**
   * Collect data from a specific source for a ticker.
   * Skips if existing data is still fresh.
   * Returns true if new data was collected or a skip was recorded.
   */
  async collectSource(symbol: string, source: string, force = false): Promise<boolean> {
    const outcome = await this.collectSourceOutcome(symbol, source, force);
    return outcome.kind !== "cached";
  }

  private async collectSourceOutcome(symbol: string, source: string, force: boolean): Promise<CollectOutcome> {
    const collector = getCollector(source);
    if (!collector) {
      throw new Error(`Unknown collector: ${source}`);
    }

    // Check if existing data is still fresh
    if (!force) {
      const existing = await prisma.dataCollection.findFirst({
        where: { symbol, source },
        orderBy: { collectedAt: "desc" },
      });

      if (existing && existing.expiresAt && existing.expiresAt > new Date()) {
        // Skipped records are never fresh — data source availability may have changed
        if (existing.status === "skipped") {
          // fall through to re-collect
        }
        // Records with all-null primary data are not worth caching
        // (e.g., IBKR fundamentals when tick 258 is rejected)
        else if (this.hasEmptyPrimaryData(existing.data, source)) {
          // fall through to re-collect
        }
        else {
          return { kind: "cached" };
        }
      }
    }

    // Collect fresh data
    const result = await withTimeout(
      collector.collect(symbol),
      `Collector "${source}" for ${symbol}`,
      collectorTimeoutMs(),
    );

    if (isSkipped(result)) {
      await prisma.dataCollection.create({
        data: {
          symbol,
          source: result.source,
          status: "skipped",
          data: DbNull,
          skipReason: result.reason,
          expiresAt: result.expiresAt,
        },
      });
      return { kind: "skipped", reason: result.reason };
    }

    await prisma.dataCollection.create({
      data: {
        symbol,
        source: result.source,
        data: result.data as Prisma.InputJsonValue,
        expiresAt: result.expiresAt,
      },
    });

    return { kind: "collected" };
  }

  /**
   * Run analyzer on the latest collected data for a source.
   * Stores the analysis result.
   */
  async analyzeSource(symbol: string, source: string): Promise<string | null> {
    return (await this.runAnalyzer(symbol, source))?.id ?? null;
  }

  private async runAnalyzer(
    symbol: string,
    source: string
  ): Promise<{ id: string; signal: string; confidence: number } | null> {
    const analyzer = getAnalyzer(source);
    if (!analyzer) return null;

    const latestData = await prisma.dataCollection.findFirst({
      where: { symbol, source, status: "ok" },
      orderBy: { collectedAt: "desc" },
    });

    if (!latestData) return null;

    const result = await analyzer.analyze(latestData.data as Record<string, unknown>);

    const analysis = await prisma.analysis.create({
      data: {
        symbol,
        source,
        signal: result.signal,
        confidence: result.confidence,
        summary: result.summary,
        details: result.details as Prisma.InputJsonValue,
      },
    });

    return { id: analysis.id, signal: result.signal, confidence: result.confidence };
  }

  /**
   * Check if a collected record has empty primary data (all null values
   * in the key data object). This happens e.g. when IBKR tick 258 is
   * rejected — the record is "ok" but fundamentals are all null.
   */
  private hasEmptyPrimaryData(data: unknown, source: string): boolean {
    if (!data || typeof data !== "object") return true;
    const record = data as Record<string, unknown>;

    // Each source has a "primary" nested object that should contain actual data
    const primaryKeys: Record<string, string> = {
      fundamentals: "fundamentals",
      technical: "ohlcv",
    };
    const key = primaryKeys[source];
    if (!key) return false; // unknown source — assume data is fine

    const primary = record[key];
    if (!primary || typeof primary !== "object") return true;
    return Object.values(primary as Record<string, unknown>).every((v) => v == null);
  }

  /** Sources collected per ticker (macro is collected separately by the macro service). */
  tickerSources(): string[] {
    return getAllCollectors().map((c) => c.source).filter((s) => s !== "macro");
  }

  /**
   * Collect every source for a ticker at once and analyze each one as soon as
   * its own data arrives, so the run takes as long as the slowest source
   * rather than the sum of fixed batches. Shared upstream limits are enforced
   * where they live (Polygon request queue, IBKR market data line budget).
   * Returns the IDs of new analysis rows.
   */
  async collectAndAnalyzeAll(
    symbol: string,
    options: { force?: boolean; sources?: string[]; onProgress?: (event: SourceProgressEvent) => void } = {}
  ): Promise<string[]> {
    const sources = options.sources || this.tickerSources();
    const emit = options.onProgress ?? (() => {});

    const results = await Promise.all(
      sources.map((source) => this.collectAndAnalyzeSource(symbol, source, !!options.force, emit))
    );
    const analysisIds = results.filter((id): id is string => id !== null);

    // Update lastAnalyzedAt after a collection+analysis pass completes,
    // even if no new analyses were produced (e.g. all sources skipped).
    // This prevents the scheduler from treating the symbol as permanently stale.
    await prisma.watchlistItem.updateMany({
      where: { symbol },
      data: { lastAnalyzedAt: new Date() },
    });

    return analysisIds;
  }

  /**
   * Collect then analyze one source, reporting each step. Never throws: a
   * failure is logged and reported on that source alone. As before, when
   * collection fails or is skipped the analyzer still runs on the last good
   * data, and the progress detail says that earlier data was used.
   */
  private async collectAndAnalyzeSource(
    symbol: string,
    source: string,
    force: boolean,
    emit: (event: SourceProgressEvent) => void
  ): Promise<string | null> {
    emit({ source, status: "collecting" });

    let outcome: CollectOutcome | null = null;
    let collectError: string | null = null;
    try {
      outcome = await this.collectSourceOutcome(symbol, source, force);
    } catch (err) {
      collectError = (err as Error).message;
      console.error(`Collection failed for ${symbol}/${source}:`, collectError);
    }
    const cached = outcome ? { cached: outcome.kind === "cached" } : {};

    emit({ source, status: "analyzing", ...cached });
    let analysis: Awaited<ReturnType<CollectionService["runAnalyzer"]>>;
    try {
      analysis = await this.runAnalyzer(symbol, source);
    } catch (err) {
      const message = (err as Error).message;
      console.error(`Analysis failed for ${symbol}/${source}:`, message);
      emit({ source, status: "failed", detail: `Analysis failed: ${message}` });
      return null;
    }

    if (!analysis) {
      if (collectError) {
        emit({ source, status: "failed", detail: collectError });
      } else {
        const reason = outcome?.kind === "skipped" ? outcome.reason : "No usable data collected";
        emit({ source, status: "skipped", ...cached, detail: reason });
      }
      return null;
    }

    let detail: string | null = null;
    if (collectError) {
      detail = `Collection failed (${collectError}) — analyzed earlier data`;
    } else if (outcome?.kind === "skipped") {
      detail = `Skipped (${outcome.reason}) — analyzed earlier data`;
    }
    emit({
      source,
      status: "done",
      ...cached,
      signal: analysis.signal,
      confidence: analysis.confidence,
      detail,
    });
    return analysis.id;
  }
}

export const collectionService = new CollectionService();
