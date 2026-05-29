/**
 * Active spreads API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { closeSpreadOrderSchema } from "@assup/shared";
import { positionService } from "../services/position.service.js";
import { groupIntoSpreads } from "../services/spreadDetection.service.js";
import * as ironCondorService from "../services/ironCondor.service.js";

const router = Router();

/**
 * GET /api/spreads/active
 * Get all active spread positions reconstructed from IBKR positions
 */
router.get(
  "/active",
  asyncHandler(async (req, res) => {
    const positions = await positionService.getPositions();
    const spreads = groupIntoSpreads(positions);
    res.json(spreads);
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

export default router;
