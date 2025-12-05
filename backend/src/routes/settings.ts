import { Router, Request, Response } from "express";
import { prisma } from "../db/index.js";

const router = Router();

export interface DashboardSettings {
  includeOptions: boolean;
  optionsWeightMode: "notional" | "delta";
}

const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  includeOptions: false,
  optionsWeightMode: "notional",
};

// GET /api/settings/:key - Get a setting by key
router.get("/:key", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;

    const setting = await prisma.setting.findUnique({
      where: { key },
    });

    if (!setting) {
      // Return default for known keys
      if (key === "dashboard") {
        res.json({ key, value: DEFAULT_DASHBOARD_SETTINGS });
        return;
      }
      res.status(404).json({ error: "Setting not found" });
      return;
    }

    res.json(setting);
  } catch (error) {
    console.error("Failed to fetch setting:", error);
    res.status(500).json({ error: "Failed to fetch setting" });
  }
});

// PUT /api/settings/:key - Update or create a setting
router.put("/:key", async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      res.status(400).json({ error: "Value is required" });
      return;
    }

    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    res.json(setting);
  } catch (error) {
    console.error("Failed to update setting:", error);
    res.status(500).json({ error: "Failed to update setting" });
  }
});

// GET /api/settings - List all settings
router.get("/", async (req: Request, res: Response) => {
  try {
    const settings = await prisma.setting.findMany();
    res.json(settings);
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

export default router;
