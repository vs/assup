/**
 * Settings API routes
 * Key-value settings storage
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { settingKeyParamSchema, settingValueSchema } from "@assup/shared";
import { NotFoundError } from "../errors/index.js";

const router = Router();

const DEFAULT_DASHBOARD_SETTINGS = {
  includeOptions: false,
  optionsWeightMode: "notional" as const,
  chartsExpanded: true,
};

const DEFAULT_RESEARCH_SETTINGS = {
  synthesizerMode: "claude-cli" as const,
};

/**
 * GET /api/settings
 * List all settings
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const settings = await prisma.setting.findMany();
    res.json(settings);
  })
);

/**
 * GET /api/settings/:key
 * Get a setting by key
 */
router.get(
  "/:key",
  validate({ params: settingKeyParamSchema }),
  asyncHandler(async (req, res) => {
    const { key } = req.params;

    const setting = await prisma.setting.findUnique({
      where: { key },
    });

    if (!setting) {
      // Return defaults for known keys
      if (key === "dashboard") {
        res.json({ key, value: DEFAULT_DASHBOARD_SETTINGS });
        return;
      }
      if (key === "research") {
        res.json({ key, value: DEFAULT_RESEARCH_SETTINGS });
        return;
      }
      // Return empty value for unknown keys instead of 404
      res.json({ key, value: null });
      return;
    }

    res.json(setting);
  })
);

/**
 * PUT /api/settings/:key
 * Update or create a setting
 */
router.put(
  "/:key",
  validate({ params: settingKeyParamSchema, body: settingValueSchema }),
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    res.json(setting);
  })
);

export default router;
