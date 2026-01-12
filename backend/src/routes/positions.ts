/**
 * Positions API routes
 * Provides endpoints for fetching portfolio positions and allocation summaries
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { positionService } from "../services/position.service.js";
import { positionSummaryQuerySchema } from "@assup/shared";
import type { OptionsWeightMode } from "@assup/shared";

const router = Router();

/**
 * GET /api/positions
 * Fetch all positions from TWS enriched with asset class information
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const positions = await positionService.getPositions();
    res.json(positions);
  })
);

/**
 * GET /api/positions/summary
 * Get position summary with allocation breakdown
 *
 * Query params:
 *   includeOptions: "true" | "false" - whether to include options in allocation
 *   optionsWeightMode: "notional" | "delta" - how to weight options
 */
router.get(
  "/summary",
  validate({ query: positionSummaryQuerySchema }),
  asyncHandler(async (req, res) => {
    // After validation, includeOptions is transformed to boolean by Zod
    const includeOptions = String(req.query.includeOptions) === "true";
    const optionsWeightMode = (req.query.optionsWeightMode as OptionsWeightMode) || "notional";

    const summary = await positionService.getSummary({
      includeOptions,
      optionsWeightMode,
    });

    res.json(summary);
  })
);

export default router;
