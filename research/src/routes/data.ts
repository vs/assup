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

/**
 * GET /api/data/:symbol
 * Latest raw DataCollection per source (status=ok) for a symbol
 */
router.get(
  "/:symbol",
  validate({ params: symbolParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol: req.params.symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", req.params.symbol);

    const collections = await prisma.$queryRaw<
      Array<{
        source: string;
        data: Record<string, unknown>;
        collectedAt: Date;
      }>
    >`
      SELECT dc.source, dc.data, dc.collected_at AS "collectedAt"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY collected_at DESC) AS rn
        FROM data_collection
        WHERE ticker_id = ${ticker.id}::uuid AND status = 'ok'
      ) dc
      WHERE dc.rn = 1
    `;

    res.json({
      symbol: ticker.symbol,
      collections,
    });
  })
);

export default router;
