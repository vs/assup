/**
 * Wheel Strategy API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { wheelService } from "../services/index.js";
import { NotFoundError, BadRequestError } from "../errors/index.js";

const router = Router();

/**
 * GET /api/wheel
 * List all tracked tickers with summary data and aggregate metrics
 */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    // Fetch tickers once, then compute metrics from the same data
    const tickers = await wheelService.getTrackedTickers();
    const metrics = wheelService.getAggregateMetricsFromSummaries(tickers);
    res.json({ tickers, metrics });
  })
);

/**
 * GET /api/wheel/suggestions
 * Get ticker suggestions based on option activity
 */
router.get(
  "/suggestions",
  asyncHandler(async (_req, res) => {
    const suggestions = await wheelService.getSuggestions();
    res.json({ suggestions });
  })
);

/**
 * GET /api/wheel/:symbol
 * Get detailed view for a single ticker
 */
router.get(
  "/:symbol",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const detail = await wheelService.getTickerDetail(symbol);

    if (!detail) {
      throw new NotFoundError(`Ticker ${symbol} is not being tracked`);
    }

    res.json(detail);
  })
);

/**
 * POST /api/wheel
 * Add a ticker to tracking
 */
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { symbol, startDate } = req.body;

    if (!symbol || typeof symbol !== "string") {
      throw new BadRequestError("Symbol is required");
    }

    const tracker = await wheelService.addTracker(symbol, startDate);
    res.status(201).json(tracker);
  })
);

/**
 * DELETE /api/wheel/:symbol
 * Remove a ticker from tracking
 */
router.delete(
  "/:symbol",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    await wheelService.removeTracker(symbol);
    res.status(204).send();
  })
);

/**
 * POST /api/wheel/suggestions/:symbol/dismiss
 * Dismiss a suggestion
 */
router.post(
  "/suggestions/:symbol/dismiss",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    await wheelService.dismissSuggestion(symbol);
    res.status(204).send();
  })
);

export default router;
