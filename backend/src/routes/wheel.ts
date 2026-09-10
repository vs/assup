/**
 * Wheel Strategy API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { wheelService } from "../services/index.js";
import { sseService } from "../services/sse.js";
import { NotFoundError, BadRequestError } from "../errors/index.js";

const router = Router();

// Single in-flight background refresh shared across all concurrent/repeated
// requests. The live market-data fan-out takes tens of seconds, so we never
// block the HTTP response on it and never run more than one at a time.
let wheelRefreshInFlight: Promise<void> | null = null;

function triggerWheelRefresh(): void {
  if (wheelRefreshInFlight) return;
  wheelRefreshInFlight = (async () => {
    try {
      const { tickers, metrics } = await wheelService.computeLiveList();
      sseService.broadcast("wheel_strategy", { tickers, metrics });
    } catch (err) {
      console.error("Wheel background refresh failed:", err);
    } finally {
      wheelRefreshInFlight = null;
    }
  })();
}

/**
 * GET /api/wheel
 * List all tracked tickers with summary data, aggregate metrics, and suggestions.
 *
 * Responds instantly from the DB summary cache (no TWS round-trip), then kicks
 * off a background refresh that fetches live IBKR prices/positions and pushes the
 * updated tickers + metrics over SSE as a "wheel_strategy" event. This keeps the
 * endpoint sub-second instead of blocking ~40s on the market-data fan-out.
 */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const includeSuggestionsParam = Array.isArray(_req.query.includeSuggestions)
      ? _req.query.includeSuggestions[0]
      : _req.query.includeSuggestions;
    const includeSuggestions = includeSuggestionsParam !== "false" && includeSuggestionsParam !== "0";

    const tickers = await wheelService.getCachedTrackedTickers();
    const metrics = wheelService.getAggregateMetricsFromSummaries(tickers);
    const suggestions = includeSuggestions ? await wheelService.getSuggestions() : [];

    res.json({ tickers, metrics, suggestions });

    // Refresh live data in the background and broadcast it when ready.
    triggerWheelRefresh();
  })
);

/**
 * GET /api/wheel/suggestions
 * Get ticker suggestions based on option activity (standalone endpoint)
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
