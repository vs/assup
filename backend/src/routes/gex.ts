/**
 * GEX (Gamma Exposure) analysis API routes.
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  getGexAnalysis,
  getStaleCacheEntry,
  getGexProfile,
  getStaleProfileCacheEntry,
} from "../services/gex.service.js";

const router = Router();

/**
 * GET /api/gex/:symbol
 *
 * Query params:
 *   expiration - ISO date string (YYYY-MM-DD) for specific expiry
 *   aggregate  - "true" to sum across expirations within 7 DTE
 *   refresh    - "true" to bypass cache
 */
router.get(
  "/:symbol",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const expiration = (req.query.expiration as string) || null;
    const aggregate = req.query.aggregate === "true";
    const forceRefresh = req.query.refresh === "true";

    try {
      const result = await getGexAnalysis(symbol, expiration, aggregate, forceRefresh);
      res.json(result);
    } catch (err) {
      // Try returning stale cache on fetch failure
      const stale = getStaleCacheEntry(symbol, expiration, aggregate);
      if (stale) {
        res.json(stale);
        return;
      }
      throw err;
    }
  }),
);

/**
 * GET /api/gex/:symbol/profile
 *
 * Dealer gamma across all expirations: per-strike GEX at spot and the net GEX
 * curve over hypothetical spots (all expiries vs ex-0DTE).
 *
 * Query params:
 *   refresh - "true" to bypass cache
 */
router.get(
  "/:symbol/profile",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const forceRefresh = req.query.refresh === "true";

    try {
      res.json(await getGexProfile(symbol, forceRefresh));
    } catch (err) {
      const stale = getStaleProfileCacheEntry(symbol);
      if (stale) {
        res.json(stale);
        return;
      }
      throw err;
    }
  }),
);

export default router;
