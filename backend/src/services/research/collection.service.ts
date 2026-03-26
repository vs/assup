import type { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";
import { getCollector, getAllCollectors } from "../collectors/registry.js";
import { getAnalyzer } from "../analyzers/registry.js";
import { isSkipped } from "../collectors/types.js";

// Prisma's DbNull representation for writing explicit null to JSON columns
const DbNull = "DbNull" as unknown as Prisma.NullTypes.DbNull;

class CollectionService {
  /**
   * Collect data from a specific source for a ticker.
   * Skips if existing data is still fresh.
   * Returns true if new data was collected or a skip was recorded.
   */
  async collectSource(tickerId: string, symbol: string, source: string, force = false): Promise<boolean> {
    const collector = getCollector(source);
    if (!collector) {
      throw new Error(`Unknown collector: ${source}`);
    }

    // Check if existing data is still fresh
    if (!force) {
      const existing = await prisma.dataCollection.findFirst({
        where: { tickerId, source },
        orderBy: { collectedAt: "desc" },
      });

      if (existing && existing.expiresAt && existing.expiresAt > new Date()) {
        return false;
      }
    }

    // Collect fresh data
    const result = await collector.collect(symbol);

    if (isSkipped(result)) {
      await prisma.dataCollection.create({
        data: {
          tickerId,
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
        tickerId,
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
  async analyzeSource(tickerId: string, source: string): Promise<string | null> {
    const analyzer = getAnalyzer(source);
    if (!analyzer) return null;

    const latestData = await prisma.dataCollection.findFirst({
      where: { tickerId, source, status: "ok" },
      orderBy: { collectedAt: "desc" },
    });

    if (!latestData) return null;

    const result = await analyzer.analyze(latestData.data as Record<string, unknown>);

    const analysis = await prisma.analysis.create({
      data: {
        tickerId,
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
   * Collect all sources for a ticker, then analyze each.
   * Returns the IDs of new analysis rows.
   */
  async collectAndAnalyzeAll(
    tickerId: string,
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
          this.collectSource(tickerId, symbol, source, options.force).catch((err) => {
            console.error(`Collection failed for ${symbol}/${source}:`, (err as Error).message);
          })
        )
      );
    }

    // Analyze each source sequentially
    for (const source of sources) {
      try {
        const analysisId = await this.analyzeSource(tickerId, source);
        if (analysisId) analysisIds.push(analysisId);
      } catch (err) {
        console.error(`Analysis failed for ${symbol}/${source}:`, (err as Error).message);
      }
    }

    // Update ticker's lastAnalyzed timestamp
    await prisma.ticker.update({
      where: { id: tickerId },
      data: { lastAnalyzed: new Date() },
    });

    return analysisIds;
  }
}

export const collectionService = new CollectionService();
