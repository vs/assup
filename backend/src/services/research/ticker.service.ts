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
    const results = [];
    const skipped = [];

    for (const symbol of symbols) {
      const existing = await prisma.ticker.findUnique({
        where: { symbol },
      });

      if (existing) {
        if (existing.status === "removed") {
          const updated = await prisma.ticker.update({
            where: { symbol },
            data: { status: "active", source },
          });
          results.push(updated);
        } else {
          skipped.push(symbol);
        }
        continue;
      }

      try {
        const ticker = await prisma.ticker.create({
          data: { symbol, source },
        });
        results.push(ticker);
      } catch (err) {
        // Unique constraint violation — another request added it concurrently
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          skipped.push(symbol);
        } else {
          throw err;
        }
      }
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
