import { Router } from "express";
import { DashboardService } from "../services/dashboard.service.js";
import { accountHistoryService } from "../services/accountHistory.service.js";
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

const validGranularities = ["daily", "weekly", "monthly"];

router.get("/account-history", async (req, res, next) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const granularity = req.query.granularity as string | undefined;

    if (from && isNaN(Date.parse(from))) {
      return res.status(400).json({
        error: `Invalid 'from' date '${from}'. Expected ISO date format: YYYY-MM-DD.`,
      });
    }
    if (to && isNaN(Date.parse(to))) {
      return res.status(400).json({
        error: `Invalid 'to' date '${to}'. Expected ISO date format: YYYY-MM-DD.`,
      });
    }
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({
        error: `'from' date (${from}) must be before 'to' date (${to}).`,
      });
    }
    if (granularity && !validGranularities.includes(granularity)) {
      return res.status(400).json({
        error: `Invalid granularity '${granularity}'. Supported: ${validGranularities.join(", ")}.`,
      });
    }

    const result = await accountHistoryService.getHistory(from, to, granularity as any);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
