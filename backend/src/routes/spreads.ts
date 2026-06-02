/**
 * Active spreads API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { closeSpreadOrderSchema } from "@assup/shared";
import * as ironCondorService from "../services/ironCondor.service.js";

const router = Router();

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
