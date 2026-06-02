/**
 * Iron Condor Builder API routes
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import {
  ironCondorOrderSchema,
} from "@assup/shared";
import * as ironCondorService from "../services/ironCondor.service.js";

const router = Router();

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
