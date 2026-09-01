/**
 * Taxes API routes
 * Endpoints for Czech tax reporting with CZK conversion
 */

import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { yearParamSchema } from "@assup/shared";
import { taxCalculationService } from "../services/taxCalculation.service.js";
import { taxExportService } from "../services/taxExport.service.js";
import { dividendReportImportService } from "../services/dividendReportImport.service.js";
import { BadRequestError } from "../errors/index.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — Dividend Reports are small.
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith(".csv");
    if (ok) cb(null, true);
    else cb(new Error("Only .csv files are allowed for Dividend Report uploads."));
  },
});

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
 * GET /api/taxes/interest/:year
 * Get interest with CZK conversion
 */
router.get(
  "/interest/:year",
  validate({ params: yearParamSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const result = await taxCalculationService.getInterest(year);
    res.json(result);
  })
);

/**
 * GET /api/taxes/lot-trace/:symbol
 * Get FIFO lot trace for a symbol
 */
router.get(
  "/lot-trace/:symbol",
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const result = await taxCalculationService.getLotTrace(symbol);
    res.json(result);
  })
);

/**
 * GET /api/taxes/option-lot-trace/:symbol
 * Get FIFO lot trace for an option contract
 */
router.get(
  "/option-lot-trace/:symbol",
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const result = await taxCalculationService.getOptionLotTrace(symbol);
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

/**
 * POST /api/taxes/dividend-report
 * Upload a Dividend Report CSV. Replaces any prior upload for the same taxYear.
 */
router.post(
  "/dividend-report",
  upload.single("file") as unknown as Parameters<typeof router.post>[1],
  asyncHandler(async (req, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw new BadRequestError("No file provided.");
    const result = await dividendReportImportService.upload(
      file.buffer.toString("utf-8"),
      file.originalname
    );
    res.status(result.status === "duplicate" ? 200 : 201).json(result);
  })
);

/**
 * GET /api/taxes/dividend-report/uploads
 * List all Dividend Report uploads.
 */
router.get(
  "/dividend-report/uploads",
  asyncHandler(async (_req, res) => {
    const uploads = await dividendReportImportService.listUploads();
    res.json({
      uploads: uploads.map((u) => ({
        id: u.id,
        filename: u.filename,
        uploadedAt: u.uploadedAt.toISOString(),
        accountNumber: u.accountNumber,
        taxYear: u.taxYear,
        recordCount: u.recordCount,
      })),
    });
  })
);

/**
 * GET /api/taxes/dividend-report/uploads/:id
 * Get one upload with its records and a FLEX-match summary.
 */
router.get(
  "/dividend-report/uploads/:id",
  asyncHandler(async (req, res) => {
    const upload = await dividendReportImportService.getUpload(req.params.id);
    if (!upload) throw new BadRequestError("Upload not found.");
    const match = await dividendReportImportService.computeMatchSummary(upload.id);
    res.json({
      upload: {
        id: upload.id,
        filename: upload.filename,
        uploadedAt: upload.uploadedAt.toISOString(),
        accountNumber: upload.accountNumber,
        taxYear: upload.taxYear,
        recordCount: upload.recordCount,
      },
      records: upload.records.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        payDate: r.payDate.toISOString().slice(0, 10),
        exDate: r.exDate ? r.exDate.toISOString().slice(0, 10) : null,
        shares: r.shares,
        country: r.country,
        revenueComponent: r.revenueComponent,
        qualifiedIndicator: r.qualifiedIndicator,
        taxCategory: r.taxCategory,
        currency: r.currency,
        grossUsd: r.grossUsd,
        withholdUsd: r.withholdUsd,
      })),
      matchSummary: match,
    });
  })
);

/**
 * DELETE /api/taxes/dividend-report/uploads/:id
 * Delete an upload and cascade its records.
 */
router.delete(
  "/dividend-report/uploads/:id",
  asyncHandler(async (req, res) => {
    await dividendReportImportService.deleteUpload(req.params.id);
    res.status(204).send();
  })
);

export default router;
