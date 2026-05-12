import { Router } from "express";
import { SecType } from "@stoqey/ib";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { tickerProfileService } from "../services/tickerProfile.service.js";
import { ibkrService } from "../services/ibkr.js";
import {
  tickerProfileParamSchema,
  tickerProfileBatchRequestSchema,
} from "@assup/shared";
import type { TickerQuoteResponse } from "@assup/shared";

const router = Router();

// GET /api/ticker-profile/:symbol/quote — real-time price from IBKR
router.get(
  "/:symbol/quote",
  validate({ params: tickerProfileParamSchema }),
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const result: TickerQuoteResponse = {
      symbol,
      last: null,
      open: null,
      close: null,
      bid: null,
      ask: null,
      volume: null,
    };

    if (ibkrService.isConnected()) {
      const data = await ibkrService.getMarketData({
        symbol,
        secType: SecType.STK,
        exchange: "SMART",
        currency: "USD",
      });
      if (data) {
        result.last = data.last ?? null;
        result.open = data.open ?? null;
        result.close = data.close ?? null;
        result.bid = data.bid ?? null;
        result.ask = data.ask ?? null;
        result.volume = data.volume ?? null;
      }
    }

    res.json(result);
  })
);

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
