/**
 * Iron Condor Builder API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import {
  ironCondorChainQuerySchema,
  ironCondorAnalyzeSchema,
  ironCondorOrderSchema,
} from "@assup/shared";
import * as ironCondorService from "../services/ironCondor.service.js";

const router = Router();

/**
 * GET /api/iron-condor/chain
 * Fetch options chain for an index symbol
 */
router.get(
  "/chain",
  validate({ query: ironCondorChainQuerySchema }),
  asyncHandler(async (req, res) => {
    const { symbol, dte } = req.query as unknown as { symbol: string; dte: number };
    const result = await ironCondorService.getChain(symbol, dte);
    res.json(result);
  }),
);

/**
 * POST /api/iron-condor/analyze
 * Compute risk/reward analysis for an iron condor configuration
 */
router.post(
  "/analyze",
  validate({ body: ironCondorAnalyzeSchema }),
  asyncHandler(async (req, res) => {
    const result = ironCondorService.analyze(req.body);
    res.json(result);
  }),
);

/**
 * POST /api/iron-condor/order
 * Place an iron condor combo order via IBKR
 */
router.post(
  "/order",
  validate({ body: ironCondorOrderSchema }),
  asyncHandler(async (req, res) => {
    const result = await ironCondorService.placeComboOrder(req.body);
    res.status(201).json(result);
  }),
);

export default router;
