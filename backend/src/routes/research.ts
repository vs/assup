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
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      500,
      Math.max(1, parseInt(req.query.limit as string, 10) || 100)
    );
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

    // Chunk into batches of 100 (research service limit)
    let totalSynced = 0;
    let totalSkipped = 0;
    for (let i = 0; i < symbols.length; i += 100) {
      const batch = symbols.slice(i, i + 100);
      const result = await researchService.syncTickers(batch);
      totalSynced += result.added.length;
      totalSkipped += result.skipped.length;
    }

    res.json({ synced: totalSynced, skipped: totalSkipped });
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

/**
 * GET /api/research/claude-status
 * Check Claude CLI availability and auth status
 */
router.get(
  "/claude-status",
  asyncHandler(async (_req, res) => {
    const result = await researchService.getClaudeStatus();
    res.json(result);
  })
);

/**
 * GET /api/research/auth/status
 * Get OAuth token auth status
 */
router.get(
  "/auth/status",
  asyncHandler(async (_req, res) => {
    const result = await researchService.getAuthStatus();
    res.json(result);
  })
);

/**
 * PUT /api/research/auth/token
 * Validate and store OAuth token
 */
router.put(
  "/auth/token",
  asyncHandler(async (req, res) => {
    const result = await researchService.setAuthToken(req.body.token);
    res.json(result);
  })
);

/**
 * DELETE /api/research/auth/token
 * Remove stored OAuth token
 */
router.delete(
  "/auth/token",
  asyncHandler(async (_req, res) => {
    const result = await researchService.deleteAuthToken();
    res.json(result);
  })
);

// ── Dynamic :symbol routes ──────────────────────────────────────────

/**
 * GET /api/research/:symbol/data
 * Get raw collection data for a symbol
 */
router.get(
  "/:symbol/data",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const result = await researchService.getCollectionData(symbol);
    res.json(result);
  })
);

/**
 * GET /api/research/:symbol
 * Get the latest report for a symbol
 */
router.get(
  "/:symbol",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const result = await researchService.getReport(symbol);
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
    const symbol = req.params.symbol.toUpperCase();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20)
    );
    const result = await researchService.getReportHistory(symbol, page, limit);
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
    const symbol = req.params.symbol.toUpperCase();
    const result = await researchService.generateReport(symbol, req.body);
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
    const symbol = req.params.symbol.toUpperCase();
    const result = await researchService.getAnalysis(symbol);
    res.json(result);
  })
);

export default router;
