/**
 * Historical Data API routes
 * Sparkline data for position charts
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { historicalDataService } from "../services/historicalData.js";
import { sparklineSymbolParamSchema, sparklineBatchRequestSchema } from "@assup/shared";

const router = Router();

/**
 * GET /api/historical/sparkline/:symbol
 * Get sparkline data for a single symbol
 */
router.get(
  "/sparkline/:symbol",
  validate({ params: sparklineSymbolParamSchema }),
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const data = await historicalDataService.getSparklineData(symbol);
    res.json({ symbol: symbol.toUpperCase(), data });
  })
);

/**
 * POST /api/historical/sparklines
 * Get sparkline data for multiple symbols
 */
router.post(
  "/sparklines",
  validate({ body: sparklineBatchRequestSchema }),
  asyncHandler(async (req, res) => {
    const { symbols } = req.body;

    // Limit to 50 symbols per request
    const limitedSymbols = symbols.slice(0, 50);
    const results = await historicalDataService.getBatchSparklineData(limitedSymbols);

    // Convert Map to object for JSON response
    const response: Record<string, { date: string; close: number }[]> = {};
    results.forEach((data, symbol) => {
      response[symbol] = data;
    });

    res.json(response);
  })
);

/**
 * GET /api/historical/cache/stats
 * Get cache statistics
 */
router.get("/cache/stats", (req, res) => {
  res.json(historicalDataService.getCacheStats());
});

export default router;
