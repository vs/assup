/**
 * Quotes API routes — observability and live subscriptions for the QuoteHub.
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { quoteHub } from "../services/quotes/index.js";

const router = Router();

/**
 * GET /api/quotes/stats
 * Market data line usage: open, leased by consumers, and idle (lingering).
 */
router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    res.json(quoteHub.stats());
  })
);

export default router;
