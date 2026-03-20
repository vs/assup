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
 * Latest analysis from all sources + skipped collection statuses
 */
router.get(
  "/:symbol",
  validate({ params: symbolParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol: req.params.symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", req.params.symbol);

    // Fetch the latest analysis per source using a window function
    const analyses = await prisma.$queryRaw<
      Array<{
        id: string;
        tickerId: string;
        source: string;
        analyzedAt: Date;
        signal: string;
        confidence: number;
        summary: string;
        details: Record<string, unknown>;
      }>
    >`
      SELECT a.id, a.ticker_id AS "tickerId", a.source,
             a.analyzed_at AS "analyzedAt", a.signal, a.confidence,
             a.summary, a.details
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY analyzed_at DESC) AS rn
        FROM analysis
        WHERE ticker_id = ${ticker.id}::uuid
      ) a
      WHERE a.rn = 1
    `;

    // Fetch latest skipped collections per source
    const collectionStatuses = await prisma.$queryRaw<
      Array<{
        source: string;
        status: string;
        skipReason: string;
        collectedAt: Date;
      }>
    >`
      SELECT dc.source, dc.status, dc.skip_reason AS "skipReason",
             dc.collected_at AS "collectedAt"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY collected_at DESC) AS rn
        FROM data_collection
        WHERE ticker_id = ${ticker.id}::uuid
      ) dc
      WHERE dc.rn = 1 AND dc.status = 'skipped'
    `;

    res.json({
      symbol: ticker.symbol,
      analyses,
      collectionStatuses,
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
