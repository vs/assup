import { prisma } from "../db/index.js";
import { NotFoundError } from "../errors/AppError.js";

class TickerService {
  async list(filters: {
    status?: string;
    source?: string;
    page: number;
    limit: number;
  }) {
    const where: Record<string, string> = {};
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;

    const [tickers, total] = await Promise.all([
      prisma.ticker.findMany({
        where,
        orderBy: { addedAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.ticker.count({ where }),
    ]);

    return { tickers, total };
  }

  async get(symbol: string) {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);
    return ticker;
  }

  async add(symbols: string[], source: string) {
    // 1. Batch-fetch all existing tickers in one query
    const existing = await prisma.ticker.findMany({
      where: { symbol: { in: symbols } },
    });
    const existingMap = new Map(existing.map((t) => [t.symbol, t]));

    // 2. Classify symbols
    const toCreate: string[] = [];
    const toReactivate: string[] = [];
    const skipped: string[] = [];

    for (const symbol of symbols) {
      const ticker = existingMap.get(symbol);
      if (!ticker) {
        toCreate.push(symbol);
      } else if (ticker.status === "removed") {
        toReactivate.push(symbol);
      } else {
        skipped.push(symbol);
      }
    }

    const results: typeof existing = [];

    // 3. Batch-reactivate removed tickers
    if (toReactivate.length > 0) {
      await prisma.ticker.updateMany({
        where: { symbol: { in: toReactivate } },
        data: { status: "active", source },
      });
      const reactivated = await prisma.ticker.findMany({
        where: { symbol: { in: toReactivate } },
      });
      results.push(...reactivated);
    }

    // 4. Batch-create new tickers (skipDuplicates eliminates TOCTOU race)
    if (toCreate.length > 0) {
      const created = await prisma.ticker.createManyAndReturn({
        data: toCreate.map((symbol) => ({ symbol, source })),
        skipDuplicates: true,
      });
      results.push(...created);
    }

    return { added: results, skipped };
  }

  async update(symbol: string, data: { status: string }) {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    return prisma.ticker.update({
      where: { symbol },
      data,
    });
  }

  async remove(symbol: string) {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    await prisma.ticker.delete({ where: { symbol } });
  }
}

export const tickerService = new TickerService();
