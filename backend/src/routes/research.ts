/**
 * Research API proxy routes
 * Proxies requests to the external research microservice
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { researchService } from "../services/research.service.js";
import { prisma } from "../db/index.js";

const router = Router();

// ── Static routes (must come before :symbol) ────────────────────────

/**
 * GET /api/research/macro
 * Get macro regime analysis
 */
router.get(
  "/macro",
  asyncHandler(async (_req, res) => {
    const result = await researchService.getMacro();
    res.json(result);
  })
);

/**
 * GET /api/research/tickers
 * List tracked tickers (query: page, limit)
 */
router.get(
  "/tickers",
  asyncHandler(async (req, res) => {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 100;
    const result = await researchService.listTickers(page, limit);
    res.json(result);
  })
);

/**
 * POST /api/research/sync-watchlist
 * Push all watchlist symbols to the research service
 */
router.post(
  "/sync-watchlist",
  asyncHandler(async (_req, res) => {
    const items = await prisma.watchlistItem.findMany({
      select: { symbol: true },
      distinct: ["symbol"],
    });
    const symbols = items.map((i: { symbol: string }) => i.symbol);

    if (symbols.length === 0) {
      res.json({ synced: 0, skipped: 0 });
      return;
    }

    const result = await researchService.syncTickers(symbols);
    res.json({ synced: result.added.length, skipped: result.skipped.length });
  })
);

/**
 * GET /api/research/jobs/:jobId
 * Get job status
 */
router.get(
  "/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const result = await researchService.getJob(req.params.jobId);
    res.json(result);
  })
);

// ── Dynamic :symbol routes ──────────────────────────────────────────

/**
 * GET /api/research/:symbol
 * Get the latest report for a symbol
 */
router.get(
  "/:symbol",
  asyncHandler(async (req, res) => {
    const result = await researchService.getReport(req.params.symbol);
    res.json(result);
  })
);

/**
 * GET /api/research/:symbol/history
 * Get report history for a symbol (query: page, limit)
 */
router.get(
  "/:symbol/history",
  asyncHandler(async (req, res) => {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 20;
    const result = await researchService.getReportHistory(
      req.params.symbol,
      page,
      limit
    );
    res.json(result);
  })
);

/**
 * POST /api/research/:symbol/generate
 * Generate a new report for a symbol (body: { force?: boolean })
 * Returns 202 with jobId
 */
router.post(
  "/:symbol/generate",
  asyncHandler(async (req, res) => {
    const result = await researchService.generateReport(
      req.params.symbol,
      req.body
    );
    res.status(202).json(result);
  })
);

/**
 * GET /api/research/:symbol/analysis
 * Get analysis summary for a symbol
 */
router.get(
  "/:symbol/analysis",
  asyncHandler(async (req, res) => {
    const result = await researchService.getAnalysis(req.params.symbol);
    res.json(result);
  })
);

export default router;
