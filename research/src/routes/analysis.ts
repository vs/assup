import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../errors/AppError.js";

const router = Router();

const symbolParamsSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
});

const sourceParamsSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  source: z.string().min(1).max(30),
});

/**
 * GET /api/analysis/:symbol
 * Latest analysis from all sources
 */
router.get(
  "/:symbol",
  validate({ params: symbolParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol: req.params.symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", req.params.symbol);

    const allAnalyses = await prisma.analysis.findMany({
      where: { tickerId: ticker.id },
      orderBy: { analyzedAt: "desc" },
    });

    // Deduplicate: keep only the latest per source
    const latestBySource = new Map<string, typeof allAnalyses[number]>();
    for (const a of allAnalyses) {
      if (!latestBySource.has(a.source)) {
        latestBySource.set(a.source, a);
      }
    }

    res.json({
      symbol: ticker.symbol,
      analyses: Array.from(latestBySource.values()),
      lastUpdated: ticker.lastAnalyzed,
    });
  })
);

/**
 * GET /api/analysis/:symbol/:source
 * Latest analysis from a specific source
 */
router.get(
  "/:symbol/:source",
  validate({ params: sourceParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol: req.params.symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", req.params.symbol);

    const analysis = await prisma.analysis.findFirst({
      where: { tickerId: ticker.id, source: req.params.source },
      orderBy: { analyzedAt: "desc" },
    });

    if (!analysis) throw new NotFoundError("Analysis", `${req.params.symbol}/${req.params.source}`);

    res.json(analysis);
  })
);

export default router;
