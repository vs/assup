import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { getCollector, getAllCollectors } from "./collectors/registry.js";
import { getAnalyzer } from "./analyzers/registry.js";
import { isSkipped } from "./collectors/types.js";
import { withTimeout } from "../../utils/withTimeout.js";

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
          return false;
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
      return true;
    }

    await prisma.dataCollection.create({
      data: {
        symbol,
        source: result.source,
        data: result.data as Prisma.InputJsonValue,
        expiresAt: result.expiresAt,
      },
    });

    return true;
  }

  /**
   * Run analyzer on the latest collected data for a source.
   * Stores the analysis result.
   */
  async analyzeSource(symbol: string, source: string): Promise<string | null> {
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

    return analysis.id;
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

  /**
   * Collect all sources for a ticker, then analyze each.
   * Returns the IDs of new analysis rows.
   */
  async collectAndAnalyzeAll(
    symbol: string,
    options: { force?: boolean; sources?: string[] } = {}
  ): Promise<string[]> {
    const collectors = getAllCollectors();
    const sources = options.sources || collectors.map((c) => c.source).filter((s) => s !== "macro");
    const analysisIds: string[] = [];

    // Collect in parallel (with concurrency limit)
    const CONCURRENCY = 3;
    for (let i = 0; i < sources.length; i += CONCURRENCY) {
      const batch = sources.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((source) =>
          this.collectSource(symbol, source, options.force).catch((err) => {
            console.error(`Collection failed for ${symbol}/${source}:`, (err as Error).message);
          })
        )
      );
    }

    // Analyze each source sequentially
    for (const source of sources) {
      try {
        const analysisId = await this.analyzeSource(symbol, source);
        if (analysisId) analysisIds.push(analysisId);
      } catch (err) {
        console.error(`Analysis failed for ${symbol}/${source}:`, (err as Error).message);
      }
    }

    // Update lastAnalyzedAt after a collection+analysis pass completes,
    // even if no new analyses were produced (e.g. all sources skipped).
    // This prevents the scheduler from treating the symbol as permanently stale.
    await prisma.watchlistItem.updateMany({
      where: { symbol },
      data: { lastAnalyzedAt: new Date() },
    });

    return analysisIds;
  }
}

export const collectionService = new CollectionService();
