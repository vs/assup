/**
 * Exchange Rates API routes
 * Endpoints for CNB exchange rate management
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { yearParamSchema, exchangeRateFetchSchema } from "@assup/shared";
import { cnbExchangeRateService } from "../services/cnbExchangeRate.service.js";

const router = Router();

/**
 * GET /api/exchange-rates/:year
 * Get all rates for a year
 */
router.get(
  "/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const rates = await cnbExchangeRateService.getRatesForYear(year);
    res.json(rates);
  })
);

/**
 * GET /api/exchange-rates/:year/status
 * Get rate coverage status for a year
 */
router.get(
  "/:year/status",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const status = await cnbExchangeRateService.getStatusForYear(year);
    res.json(status);
  })
);

/**
 * POST /api/exchange-rates/fetch
 * Fetch rates for date range from CNB
 */
router.post(
  "/fetch",
  validate({ body: exchangeRateFetchSchema }),
  asyncHandler(async (req, res) => {
    const { startDate, currencies } = req.body;
    // Note: endDate is accepted by the schema but not used — rates are fetched for the entire year
    const start = new Date(startDate);
    const year = start.getFullYear();

    const result = await cnbExchangeRateService.prefetchRatesForYear(
      year,
      currencies || ["USD", "EUR"]
    );

    res.json({
      message: "Rates fetched successfully",
      ...result,
    });
  })
);

export default router;
