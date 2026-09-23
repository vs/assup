/**
 * Quotes API routes — observability and live subscriptions for the QuoteHub.
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { quoteHub } from "../services/quotes/index.js";
import { clientQuoteSubscriptions } from "../services/quotes/clientQuoteSubscriptions.js";

const router = Router();

const quoteSubscriptionsSchema = z.object({
  clientId: z.string().min(1).max(100),
  conIds: z.array(z.number().int().positive()).max(100),
});

/**
 * GET /api/quotes/stats
 * Market data line usage: open, leased by consumers, and idle (lingering).
 */
router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    res.json({ ...quoteHub.stats(), sseClients: clientQuoteSubscriptions.stats() });
  })
);

/**
 * POST /api/quotes/subscriptions
 * Set the full list of contracts this SSE client wants streamed. Their quotes
 * arrive as "quote" events on /api/updates/stream.
 */
router.post(
  "/subscriptions",
  validate({ body: quoteSubscriptionsSchema }),
  asyncHandler(async (req, res) => {
    const { clientId, conIds } = req.body;
    clientQuoteSubscriptions.set(clientId, conIds);
    res.json(clientQuoteSubscriptions.stats());
  })
);

export default router;
