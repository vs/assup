import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { tickerProfileService } from "../services/tickerProfile.service.js";
import {
  tickerProfileParamSchema,
  tickerProfileBatchRequestSchema,
} from "@assup/shared";

const router = Router();

// GET /api/ticker-profile/:symbol
router.get(
  "/:symbol",
  validate({ params: tickerProfileParamSchema }),
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const profile = await tickerProfileService.getProfile(symbol);
    res.json(profile);
  })
);

// POST /api/ticker-profile/batch
router.post(
  "/batch",
  validate({ body: tickerProfileBatchRequestSchema }),
  asyncHandler(async (req, res) => {
    const { symbols } = req.body;
    const profiles = await tickerProfileService.getBatchProfiles(symbols);
    res.json(profiles);
  })
);

export default router;
