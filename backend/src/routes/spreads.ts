/**
 * Active spreads API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { closeSpreadOrderSchema } from "@assup/shared";
import * as ironCondorService from "../services/ironCondor.service.js";
import { positionService } from "../services/position.service.js";
import { groupIntoSpreads } from "../services/spreadDetection.service.js";
import { getExpirations } from "../services/spreadExpirations.service.js";
import { spreadStrategyService } from "../services/spreadStrategy.service.js";

const router = Router();

/**
 * GET /api/spreads/positions
 * Get active spread positions (matched from IBKR positions)
 */
router.get(
  "/positions",
  asyncHandler(async (_req, res) => {
    const positions = await positionService.getPositions();
    const spreads = groupIntoSpreads(positions);
    res.json({ spreads });
  }),
);

/**
 * POST /api/spreads/close
 * Close a spread via a combo (BAG) order
 */
router.post(
  "/close",
  validate({ body: closeSpreadOrderSchema }),
  asyncHandler(async (req, res) => {
    const result = await ironCondorService.placeComboOrder(req.body);
    res.status(201).json(result);
  }),
);

/**
 * GET /api/spreads/expirations?symbol=SPX
 * Fetch available option expirations for a symbol (cached for 1 hour)
 */
router.get(
  "/expirations",
  asyncHandler(async (req, res) => {
    const symbol = (req.query.symbol as string) ?? "SPX";
    const expirations = await getExpirations(symbol);
    res.json({ expirations });
  }),
);

/**
 * GET /api/spreads/strategy?symbol=SPX
 * Compute strategy metrics for a symbol (VIX-based strike selection, filters, sizing)
 */
router.get(
  "/strategy",
  asyncHandler(async (req, res) => {
    const symbol = (req.query.symbol as string) ?? "SPX";
    const metrics = await spreadStrategyService.getMetrics(symbol);
    res.json(metrics);
  }),
);

/**
 * POST /api/spreads/strategy/record-loss
 * Record a loss to activate cooloff period
 */
router.post(
  "/strategy/record-loss",
  asyncHandler(async (req, res) => {
    const { symbol, date } = req.body as { symbol: string; date?: string };
    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }
    await spreadStrategyService.recordLoss(symbol, date);
    res.status(204).send();
  }),
);

/**
 * POST /api/spreads/strategy/clear-cooloff
 * Clear cooloff for a symbol
 */
router.post(
  "/strategy/clear-cooloff",
  asyncHandler(async (req, res) => {
    const { symbol } = req.body as { symbol: string };
    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }
    await spreadStrategyService.clearCooloff(symbol);
    res.status(204).send();
  }),
);

export default router;
