/**
 * Profit API routes
 * Endpoints for importing trade data and viewing profit summaries
 */

import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { importService, profitService } from "../services/index.js";
import {
  monthlyProfitQuerySchema,
  monthParamsSchema,
  importBatchIdParamSchema,
} from "@assup/shared";
import { NotFoundError, BadRequestError } from "../errors/index.js";

const router = Router();

// Configure multer for file uploads (in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept XML and CSV files
    const allowedTypes = [
      "text/xml",
      "application/xml",
      "text/csv",
      "application/csv",
      "text/plain",
    ];
    const allowedExtensions = [".xml", ".csv", ".txt"];

    const hasValidMime = allowedTypes.some(
      (type) =>
        file.mimetype === type || file.mimetype.includes("xml") || file.mimetype.includes("csv")
    );
    const hasValidExt = allowedExtensions.some((ext) =>
      file.originalname.toLowerCase().endsWith(ext)
    );

    if (hasValidMime || hasValidExt) {
      cb(null, true);
    } else {
      cb(new Error("Only XML and CSV files are allowed"));
    }
  },
});

/**
 * POST /api/profit/import
 * Import a Flex Query file (XML or CSV)
 */
router.post(
  "/import",
  upload.single("file") as unknown as Parameters<typeof router.post>[1],
  asyncHandler(async (req, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      throw new BadRequestError("No file provided");
    }

    const fileContent = file.buffer.toString("utf-8");
    const filename = file.originalname;

    const result = await importService.importFlexQuery(fileContent, filename);
    res.status(201).json(result);
  })
);

/**
 * GET /api/profit/imports
 * List all import batches
 */
router.get(
  "/imports",
  asyncHandler(async (_req, res) => {
    const imports = await importService.getImportBatches();
    res.json({
      imports: imports.map((batch) => ({
        id: batch.id,
        filename: batch.filename,
        importedAt: batch.importedAt.toISOString(),
        periodStart: batch.periodStart.toISOString().split("T")[0],
        periodEnd: batch.periodEnd.toISOString().split("T")[0],
        recordCount: batch.recordCount,
      })),
    });
  })
);

/**
 * DELETE /api/profit/imports/:id
 * Delete an import batch and all associated records
 */
router.delete(
  "/imports/:id",
  validate({ params: importBatchIdParamSchema }),
  asyncHandler(async (req, res) => {
    try {
      await importService.deleteImportBatch(req.params.id);
      res.status(204).send();
    } catch {
      throw new NotFoundError("Import batch not found");
    }
  })
);

/**
 * GET /api/profit/years
 * Get list of years that have profit data
 */
router.get(
  "/years",
  asyncHandler(async (_req, res) => {
    const years = await profitService.getAvailableYears();
    res.json({ years });
  })
);

/**
 * GET /api/profit/monthly
 * Get monthly profit summaries
 */
router.get(
  "/monthly",
  validate({ query: monthlyProfitQuerySchema }),
  asyncHandler(async (req, res) => {
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;

    const result = await profitService.getMonthlyProfits(startDate, endDate);
    res.json(result);
  })
);

/**
 * GET /api/profit/month/:year/:month
 * Get detailed breakdown for a specific month
 */
router.get(
  "/month/:year/:month",
  validate({ params: monthParamsSchema }),
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);

    const result = await profitService.getMonthDetail(year, month);
    res.json(result);
  })
);

/**
 * GET /api/profit/current
 * Get current month profit with unrealized and projected
 */
router.get(
  "/current",
  asyncHandler(async (_req, res) => {
    const result = await profitService.getCurrentMonthProfit();
    res.json(result);
  })
);

/**
 * GET /api/profit/next
 * Get next month profit with unrealized and projected
 */
router.get(
  "/next",
  asyncHandler(async (_req, res) => {
    const result = await profitService.getNextMonthProfit();
    res.json(result);
  })
);

/**
 * POST /api/profit/detect-assignments
 * Manually trigger assignment detection
 */
router.post(
  "/detect-assignments",
  asyncHandler(async (_req, res) => {
    const detected = await importService.detectAssignments();
    res.json({ assignmentsDetected: detected });
  })
);

/**
 * POST /api/profit/recalculate-assignments
 * Clear and re-detect assignments for all expired options.
 * Use this to fix false positives from earlier detection runs.
 */
router.post(
  "/recalculate-assignments",
  asyncHandler(async (_req, res) => {
    const result = await importService.recalculateAssignments();
    res.json(result);
  })
);

export default router;
