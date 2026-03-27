import { Router } from "express";
import { wheelScannerService } from "../services/wheelScanner.service.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();

// Configs
router.get("/configs", asyncHandler(async (_req, res) => {
  const configs = await wheelScannerService.getConfigs();
  res.json(configs);
}));

router.post("/configs", asyncHandler(async (req, res) => {
  const config = await wheelScannerService.upsertConfig(req.body);
  res.json(config);
}));

router.delete("/configs/:id", asyncHandler(async (req, res) => {
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

router.get("/scans/:id", asyncHandler(async (req, res) => {
  const scan = await wheelScannerService.getScan(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  res.json(scan);
}));

export default router;
