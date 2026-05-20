import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { wheelStrategyService } from "../services/wheelStrategy.service.js";
import { wheelStrategyScheduler } from "../services/wheelStrategy.scheduler.js";
import { wheelService } from "../services/wheel.service.js";
import { ibkrService } from "../services/ibkr.js";
import { SecType, OptionType } from "@stoqey/ib";

const router = Router();

const idParamSchema = z.object({
  id: z.string().uuid("Invalid ID"),
});

const scanIdParamSchema = z.object({
  scanId: z.string().uuid("Invalid scan ID"),
});

const strategyInputSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().optional(),
  minMarketCap: z.number().positive().optional(),
  cspMinDte: z.number().int().positive().optional(),
  cspMaxDte: z.number().int().positive().optional(),
  cspMaxDelta: z.number().negative().optional(),
  cspMinRoi: z.number().positive().optional(),
  cspMaxRoi: z.number().positive().optional(),
  ccMinDte: z.number().int().positive().optional(),
  ccMaxDte: z.number().int().positive().optional(),
  ccMinRoi: z.number().positive().nullable().optional(),
  maxPositions: z.number().int().positive().optional(),
  maxPerAssetClass: z.number().int().positive().optional(),
  targetAssetClasses: z.array(z.string().uuid()).optional(),
  acceptedRecommendations: z.array(z.enum(["buy", "sell", "wheel", "hold", "avoid"])).optional(),
  minResearchConfidence: z.number().min(0).max(1).nullable().optional(),
  requireFreshReport: z.boolean().optional(),
  reportMaxAgeDays: z.number().int().positive().optional(),
  intervalHours: z.number().positive().nullable().optional(),
  cronExpression: z.string().max(100).nullable().optional(),
});

const executeInputSchema = z.object({
  type: z.enum(["csp", "cc"]),
  symbol: z.string().min(1),
  strike: z.number().positive(),
  expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  quantity: z.number().int().positive(),
  limitPrice: z.number().positive(),
});

// --- Strategy CRUD ---

router.get("/", asyncHandler(async (_req, res) => {
  const strategies = await wheelStrategyService.list();
  res.json(strategies);
}));

router.post("/", validate({ body: strategyInputSchema }), asyncHandler(async (req, res) => {
  const strategy = await wheelStrategyService.create(req.body);
  wheelStrategyScheduler.registerJob(strategy.id, strategy.intervalHours, strategy.cronExpression);
  res.status(201).json(strategy);
}));

// NOTE: /scans/:scanId must be registered BEFORE /:id to prevent Express matching "scans" as :id

router.get("/scans/:scanId", validate({ params: scanIdParamSchema }), asyncHandler(async (req, res) => {
  const scan = await wheelStrategyService.getScan(req.params.scanId);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  res.json(scan);
}));

router.post("/scans/:scanId/execute", validate({ params: scanIdParamSchema, body: executeInputSchema }), asyncHandler(async (req, res) => {
  const scan = await wheelStrategyService.getScan(req.params.scanId);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }

  if (!ibkrService.isConnected()) {
    res.status(503).json({ error: "IBKR not connected" });
    return;
  }

  const { type, symbol, strike, expiration, quantity, limitPrice } = req.body;

  // Convert YYYY-MM-DD to YYYYMMDD for IBKR
  const ibkrExpiration = expiration.replace(/-/g, "");

  const contract = {
    symbol,
    secType: SecType.OPT,
    exchange: "SMART",
    currency: "USD",
    lastTradeDateOrContractMonth: ibkrExpiration,
    strike,
    right: type === "csp" ? OptionType.Put : OptionType.Call,
    multiplier: 100,
    tradingClass: symbol,
  };

  const action = "SELL";
  const orderId = await ibkrService.placeOrder(contract, {
    action,
    quantity,
    limitPrice,
    orderType: "LMT",
    tif: "DAY",
  });

  // Auto-add to wheel tracker for CSP orders
  if (type === "csp") {
    try {
      await wheelService.addTracker(symbol);
    } catch {
      // Already tracked — that's fine
    }
  }

  res.status(201).json({ orderId, symbol, action, quantity });
}));

router.get("/:id", validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const strategy = await wheelStrategyService.get(req.params.id);
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(strategy);
}));

router.put("/:id", validate({ params: idParamSchema, body: strategyInputSchema.partial() }), asyncHandler(async (req, res) => {
  const strategy = await wheelStrategyService.update(req.params.id, req.body);
  if (strategy.enabled) {
    wheelStrategyScheduler.registerJob(strategy.id, strategy.intervalHours, strategy.cronExpression);
  } else {
    wheelStrategyScheduler.removeJob(strategy.id);
  }
  res.json(strategy);
}));

router.delete("/:id", validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  wheelStrategyScheduler.removeJob(req.params.id);
  await wheelStrategyService.delete(req.params.id);
  res.json({ ok: true });
}));

// --- Scan Operations ---

router.post("/:id/scan", validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const strategy = await wheelStrategyService.get(req.params.id);
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  const scanId = await wheelStrategyService.startScan(req.params.id);
  res.status(202).json({ scanId });
}));

router.get("/:id/scans", validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const scans = await wheelStrategyService.getScans(req.params.id, limit);
  res.json(scans);
}));

export default router;
