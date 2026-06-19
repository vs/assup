import { Router } from "express";
import { DashboardService } from "../services/dashboard.service.js";
import { DashboardPeriod } from "@assup/shared";

const router = Router();

const dashboardService = new DashboardService();
const validPeriods: DashboardPeriod[] = ["mtd", "ytd", "year", "all"];

router.get("/summary", async (req, res, next) => {
  try {
    const period = (req.query.period as string) || "ytd";
    if (!validPeriods.includes(period as DashboardPeriod)) {
      return res.status(400).json({
        error: `Invalid period '${period}'. Supported: ${validPeriods.join(", ")}`,
      });
    }

    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
    if (year !== undefined && (isNaN(year) || year < 2000 || year > 2100)) {
      return res.status(400).json({
        error: `Invalid year '${req.query.year}'. Must be a number between 2000 and 2100.`,
      });
    }

    const summary = await dashboardService.getSummary(period as DashboardPeriod, year);

    res.json(summary);
  } catch (error) {
    next(error);
  }
});

export default router;
