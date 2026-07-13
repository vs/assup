import { Router } from "express";
import { calendarService } from "../services/calendar.service.js";
import type { CalendarEventType } from "@assup/shared";

const router = Router();

// GET /api/calendar?start=2026-03-01&end=2026-03-31&types=EARNINGS,FOMC&symbol=AAPL
router.get("/", async (req, res, next) => {
  try {
    const { start, end, types, symbol } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start and end query parameters are required" });
    }

    const filters: { types?: CalendarEventType[]; symbol?: string } = {};
    if (types) filters.types = (types as string).split(",") as CalendarEventType[];
    if (symbol) filters.symbol = symbol as string;

    const events = await calendarService.getEvents(start as string, end as string, filters);
    res.json(events);
  } catch (error) {
    next(error);
  }
});

// GET /api/calendar/today?days=5
router.get("/today", async (req, res, next) => {
  try {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 5;
    const events = await calendarService.getTodayAndUpcoming(days);
    res.json(events);
  } catch (error) {
    next(error);
  }
});

// GET /api/calendar/ticker/:symbol
router.get("/ticker/:symbol", async (req, res, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
    const events = await calendarService.getEventsBySymbol(req.params.symbol, limit);
    res.json(events);
  } catch (error) {
    next(error);
  }
});

// POST /api/calendar/sync
router.post("/sync", async (req, res, next) => {
  try {
    await calendarService.syncAll();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/calendar/purge
router.post("/purge", async (req, res, next) => {
  try {
    await calendarService.purgeAndResync();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/calendar/settings
router.get("/settings", async (req, res, next) => {
  try {
    const settings = await calendarService.getSettings();
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// PUT /api/calendar/settings
router.put("/settings", async (req, res, next) => {
  try {
    await calendarService.updateSettings(req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
