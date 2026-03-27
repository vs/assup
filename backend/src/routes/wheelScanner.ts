import { Router } from "express";
import { z } from "zod";
import { wheelScannerService } from "../services/wheelScanner.service.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const wheelScanConfigSchema = z.object({
  assetClassId: z.string().uuid("Invalid asset class ID"),
  searchKeywords: z.array(z.string().min(1).max(100)).min(0).max(20),
  seedTickers: z.array(z.string().min(1).max(10).toUpperCase()).min(0).max(50),
  minPrice: z.number().min(0).max(100000).optional(),
  maxPrice: z.number().min(0).max(100000).optional(),
  minMarketCap: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid("Invalid ID"),
});

// Configs
router.get("/configs", asyncHandler(async (_req, res) => {
  const configs = await wheelScannerService.getConfigs();
  res.json(configs);
}));

router.post("/configs", validate({ body: wheelScanConfigSchema }), asyncHandler(async (req, res) => {
  const config = await wheelScannerService.upsertConfig(req.body);
  res.json(config);
}));

router.delete("/configs/:id", validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  await wheelScannerService.deleteConfig(req.params.id);
  res.json({ ok: true });
}));

// Scans
router.post("/scan", asyncHandler(async (_req, res) => {
  const scanId = await wheelScannerService.startScan();
  res.status(202).json({ scanId });
}));

router.get("/scans", asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const scans = await wheelScannerService.getScans(limit);
  res.json(scans);
}));

router.get("/scans/:id", validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const scan = await wheelScannerService.getScan(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  res.json(scan);
}));

export default router;
