import type { Prisma, ScreenerConfig } from "@prisma/client";
import { prisma } from "../db/index.js";
import { getMarketDataProvider } from "../providers/index.js";
import type { TickerSearchResult } from "../providers/types.js";
import { tickerService } from "./ticker.service.js";
import { pipelineService } from "./pipeline.service.js";
import { NotFoundError } from "../errors/AppError.js";

interface ScreenerCriteria {
  // Provider-level filters
  market?: string; // default "stocks"
  type?: string; // "CS", "ETF"
  search?: string; // text search
  active?: boolean; // default true

  // Post-filter criteria
  minMarketCap?: number;
  maxMarketCap?: number;
  minPrice?: number;
  maxPrice?: number;

  // Control
  maxResults?: number; // default 20, max 50
}

function postFilter(
  results: TickerSearchResult[],
  criteria: ScreenerCriteria
): TickerSearchResult[] {
  return results.filter((r) => {
    // Null values fail constraints — unknown data should not pass filters
    if (criteria.minMarketCap != null) {
      if (r.marketCap == null || r.marketCap < criteria.minMarketCap)
        return false;
    }
    if (criteria.maxMarketCap != null) {
      if (r.marketCap == null || r.marketCap > criteria.maxMarketCap)
        return false;
    }
    if (criteria.minPrice != null) {
      if (r.lastPrice == null || r.lastPrice < criteria.minPrice) return false;
    }
    if (criteria.maxPrice != null) {
      if (r.lastPrice == null || r.lastPrice > criteria.maxPrice) return false;
    }
    return true;
  });
}

class ScreenerService {
  /**
   * Run a screener config by ID.
   * 1. Load config from DB
   * 2. Search tickers via provider
   * 3. Post-filter by criteria (marketCap, price)
   * 4. Cap results at maxResults
   * 5. Auto-add discovered tickers with source "screener"
   * 6. Trigger report generation for newly added tickers
   * 7. Update lastRun timestamp
   * 8. Return results summary
   */
  async runScreener(configId: string): Promise<{
    discovered: string[];
    added: string[];
    skipped: string[];
    reportsQueued: number;
  }> {
    const config = await prisma.screenerConfig.findUnique({
      where: { id: configId },
    });
    if (!config) throw new NotFoundError("ScreenerConfig", configId);

    const criteria = config.criteria as unknown as ScreenerCriteria;

    // Search tickers via market data provider
    const provider = getMarketDataProvider();
    const searchResults = await provider.searchTickers({
      market: criteria.market ?? "stocks",
      type: criteria.type,
      search: criteria.search,
      active: criteria.active ?? true,
      limit: 100,
    });

    // Post-filter by marketCap and price
    const filtered = postFilter(searchResults, criteria);

    // Cap at maxResults (default 20, max 50)
    const maxResults = Math.min(criteria.maxResults ?? 20, 50);
    const capped = filtered.slice(0, maxResults);

    // Extract discovered symbols
    const discovered = capped.map((r) => r.symbol);

    // Auto-add discovered tickers
    const { added, skipped } = await tickerService.add(discovered, "screener");
    const addedSymbols = added.map((t) => t.symbol);

    // Trigger report generation for newly added tickers (non-fatal)
    let reportsQueued = 0;
    for (const symbol of addedSymbols) {
      try {
        await pipelineService.generateReport(symbol);
        reportsQueued++;
      } catch (err) {
        console.error(
          `[Screener] Report generation failed for ${symbol}:`,
          (err as Error).message
        );
      }
    }

    // Update lastRun timestamp
    await prisma.screenerConfig.update({
      where: { id: configId },
      data: { lastRun: new Date() },
    });

    return {
      discovered,
      added: addedSymbols,
      skipped,
      reportsQueued,
    };
  }

  /**
   * Get recent screener-discovered tickers.
   * Returns tickers with source='screener', sorted by addedAt desc.
   */
  async getResults(options: { page: number; limit: number }): Promise<{
    tickers: Array<{ symbol: string; addedAt: Date; status: string }>;
    total: number;
  }> {
    const where = { source: "screener" };

    const [tickers, total] = await Promise.all([
      prisma.ticker.findMany({
        where,
        orderBy: { addedAt: "desc" },
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: { symbol: true, addedAt: true, status: true },
      }),
      prisma.ticker.count({ where }),
    ]);

    return { tickers, total };
  }

  /**
   * Create a new screener config.
   */
  async createConfig(data: {
    name: string;
    criteria: ScreenerCriteria;
    schedule: string;
    enabled?: boolean;
  }): Promise<ScreenerConfig> {
    return prisma.screenerConfig.create({
      data: {
        name: data.name,
        criteria: data.criteria as Prisma.InputJsonValue,
        schedule: data.schedule,
        enabled: data.enabled ?? true,
      },
    });
  }

  /**
   * Get a screener config by ID.
   */
  async getConfig(id: string): Promise<ScreenerConfig> {
    const config = await prisma.screenerConfig.findUnique({
      where: { id },
    });
    if (!config) throw new NotFoundError("ScreenerConfig", id);
    return config;
  }

  /**
   * List all screener configs.
   */
  async listConfigs(): Promise<ScreenerConfig[]> {
    return prisma.screenerConfig.findMany();
  }

  /**
   * Update a screener config.
   */
  async updateConfig(
    id: string,
    data: Partial<{
      name: string;
      criteria: ScreenerCriteria;
      schedule: string;
      enabled: boolean;
    }>
  ): Promise<ScreenerConfig> {
    const existing = await prisma.screenerConfig.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundError("ScreenerConfig", id);

    return prisma.screenerConfig.update({
      where: { id },
      data: {
        ...data,
        criteria: data.criteria
          ? (data.criteria as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  /**
   * Delete a screener config.
   */
  async deleteConfig(id: string): Promise<void> {
    const existing = await prisma.screenerConfig.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundError("ScreenerConfig", id);

    await prisma.screenerConfig.delete({ where: { id } });
  }
}

export type { ScreenerCriteria };
export const screenerService = new ScreenerService();
