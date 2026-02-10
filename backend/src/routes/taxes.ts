/**
 * Taxes API routes
 * Endpoints for Czech tax reporting with CZK conversion
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { yearParamSchema } from "@assup/shared";
import { taxCalculationService } from "../services/taxCalculation.service.js";
import { taxExportService } from "../services/taxExport.service.js";
import { BadRequestError } from "../errors/index.js";

const router = Router();

/**
 * GET /api/taxes/summary/:year
 * Get tax summary for year
 */
router.get(
  "/summary/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const summary = await taxCalculationService.getSummary(year);
    res.json(summary);
  })
);

/**
 * GET /api/taxes/stock-trades/:year
 * Get stock trades with CZK conversion
 */
router.get(
  "/stock-trades/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const result = await taxCalculationService.getStockTrades(year);
    res.json(result);
  })
);

/**
 * GET /api/taxes/option-trades/:year
 * Get option trades with CZK conversion
 */
router.get(
  "/option-trades/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const result = await taxCalculationService.getOptionTrades(year);
    res.json(result);
  })
);

/**
 * GET /api/taxes/dividends/:year
 * Get dividends with CZK conversion
 */
router.get(
  "/dividends/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const result = await taxCalculationService.getDividends(year);
    res.json(result);
  })
);

/**
 * GET /api/taxes/export/:year
 * Download XLSX export
 */
router.get(
  "/export/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);

    // Check if export is possible
    const summary = await taxCalculationService.getSummary(year);
    if (!summary.canExport) {
      throw new BadRequestError(
        `Cannot export: ${summary.missingRecords.length} missing trade records. ` +
          `Import the missing FLEX reports first.`
      );
    }

    const buffer = await taxExportService.generateExport(year);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tax-report-${year}-CZK.xlsx"`
    );
    res.send(buffer);
  })
);

export default router;
