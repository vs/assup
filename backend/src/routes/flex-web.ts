import { Router } from "express";
import cron from "node-cron";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { flexWebConfigSchema, flexFetchLogQuerySchema } from "@assup/shared";
import { flexWebService } from "../services/flex-web.service.js";

const router = Router();

// GET /api/flex-web/config
router.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const config = await flexWebService.getConfig();
    // Mask the token for security
    res.json({
      ...config,
      token: config.token ? "••••" + config.token.slice(-4) : "",
    });
  })
);

// PUT /api/flex-web/config
router.put(
  "/config",
  validate({ body: flexWebConfigSchema }),
  asyncHandler(async (req, res) => {
    // Server-side cron validation using node-cron (Zod only checks field count)
    if (req.body.schedule && !cron.validate(req.body.schedule)) {
      res.status(400).json({ error: "Invalid cron expression" });
      return;
    }
    await flexWebService.updateConfig(req.body);
    res.json({ success: true });
  })
);

// POST /api/flex-web/fetch
router.post(
  "/fetch",
  asyncHandler(async (_req, res) => {
    const result = await flexWebService.fetchAndImport("manual");
    res.json(result);
  })
);

// GET /api/flex-web/log
router.get(
  "/log",
  validate({ query: flexFetchLogQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const result = await flexWebService.getLogs(page || 1, limit || 20);
    res.json(result);
  })
);

export default router;
