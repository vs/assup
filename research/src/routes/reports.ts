import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { pipelineService } from "../services/pipeline.service.js";
import { NotFoundError } from "../errors/AppError.js";

const router = Router();

const symbolParamsSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const generateBodySchema = z.object({
  force: z.boolean().default(false),
  model: z.enum(["claude-sonnet-4-6", "claude-opus-4-6"]).default("claude-sonnet-4-6"),
  mode: z.enum(["claude-cli", "api"]).optional(),
}).default({});

/**
 * GET /api/reports/:symbol
 * Latest report for ticker
 */
router.get(
  "/:symbol",
  validate({ params: symbolParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol: req.params.symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", req.params.symbol);

    const report = await prisma.report.findFirst({
      where: { tickerId: ticker.id },
      orderBy: { createdAt: "desc" },
    });

    if (!report) throw new NotFoundError("Report", req.params.symbol);

    res.json({ ...report, symbol: ticker.symbol });
  })
);

/**
 * GET /api/reports/:symbol/history
 * All historical reports for ticker
 */
router.get(
  "/:symbol/history",
  validate({ params: symbolParamsSchema, query: historyQuerySchema }),
  asyncHandler(async (req, res) => {
    const ticker = await prisma.ticker.findUnique({
      where: { symbol: req.params.symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", req.params.symbol);

    const { page, limit } = req.query as unknown as { page: number; limit: number };

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where: { tickerId: ticker.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.report.count({ where: { tickerId: ticker.id } }),
    ]);

    res.json({
      reports: reports.map((r) => ({ ...r, symbol: ticker.symbol })),
      total,
    });
  })
);

/**
 * POST /api/reports/:symbol/generate
 * Trigger fresh report generation (async)
 */
router.post(
  "/:symbol/generate",
  validate({ params: symbolParamsSchema, body: generateBodySchema }),
  asyncHandler(async (req, res) => {
    const { force, model, mode } = req.body;
    const jobId = await pipelineService.generateReport(
      req.params.symbol,
      { force, model, mode }
    );
    res.status(202).json({ jobId, status: "queued" });
  })
);

export default router;
