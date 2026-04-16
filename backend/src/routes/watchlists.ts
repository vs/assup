/**
 * Watchlists API routes
 * CRUD operations for watchlists and their items
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { assignmentService, getSecurityKey } from "../services/assignment.service.js";
import {
  watchlistCreateSchema,
  watchlistUpdateSchema,
  watchlistIdParamSchema,
  watchlistItemCreateSchema,
  watchlistItemIdParamSchema,
  watchlistReorderSchema,
  watchlistMoveItemSchema,
} from "@assup/shared";
import { NotFoundError } from "../errors/index.js";

const router = Router();

/**
 * GET /api/watchlists
 * List all watchlists with item counts
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const watchlists = await prisma.watchlist.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
      },
    });
    res.json(watchlists);
  })
);

/**
 * GET /api/watchlists/:id
 * Get watchlist with enriched items (asset class + research data)
 */
router.get(
  "/:id",
  validate({ params: watchlistIdParamSchema }),
  asyncHandler(async (req, res) => {
    const watchlist = await prisma.watchlist.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: [{ sortOrder: "asc" }, { addedAt: "desc" }] },
      },
    });

    if (!watchlist) {
      throw new NotFoundError("Watchlist not found");
    }

    // Enrich items with asset class info
    const assignmentMap = await assignmentService.getAssignmentMap();

    // Batch fetch latest research data for all symbols
    const symbols = watchlist.items.map((item) => item.symbol);

    const [latestReports, latestAnalyses] = await Promise.all([
      symbols.length > 0
        ? prisma.$queryRaw<Array<{ symbol: string; recommendation: string; createdAt: Date }>>`
            SELECT r.symbol, r.recommendation, r.created_at AS "createdAt"
            FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY created_at DESC) AS rn
              FROM research_report
              WHERE symbol = ANY(${symbols})
            ) r
            WHERE r.rn = 1
          `
        : [],
      symbols.length > 0
        ? prisma.$queryRaw<Array<{ symbol: string; signal: string; confidence: number }>>`
            SELECT a.symbol, a.signal, a.confidence
            FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY analyzed_at DESC) AS rn
              FROM analysis
              WHERE symbol = ANY(${symbols})
            ) a
            WHERE a.rn = 1
          `
        : [],
    ]);

    const reportMap = new Map(latestReports.map((r) => [r.symbol, r]));
    const analysisMap = new Map(latestAnalyses.map((a) => [a.symbol, a]));

    const enrichedItems = watchlist.items.map((item) => {
      const assignment = assignmentMap.get(getSecurityKey(item.symbol, item.secType));
      const report = reportMap.get(item.symbol);
      const analysis = analysisMap.get(item.symbol);

      // Compute human-readable report age
      let reportAge: string | null = null;
      if (report) {
        const diffMs = Date.now() - new Date(report.createdAt).getTime();
        const diffMins = Math.floor(diffMs / 60_000);
        if (diffMins < 60) {
          reportAge = `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
        } else {
          const diffHours = Math.floor(diffMins / 60);
          if (diffHours < 24) {
            reportAge = `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
          } else {
            const diffDays = Math.floor(diffHours / 24);
            reportAge = `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
          }
        }
      }

      return {
        ...item,
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
        latestSignal: analysis?.signal ?? null,
        latestConfidence: analysis?.confidence ?? null,
        latestRecommendation: report?.recommendation ?? null,
        reportAge,
      };
    });

    res.json({ ...watchlist, items: enrichedItems });
  })
);

/**
 * POST /api/watchlists
 * Create a new watchlist
 */
router.post(
  "/",
  validate({ body: watchlistCreateSchema }),
  asyncHandler(async (req, res) => {
    const { name } = req.body;

    const watchlist = await prisma.watchlist.create({
      data: { name },
    });

    res.status(201).json(watchlist);
  })
);

/**
 * PUT /api/watchlists/:id
 * Update a watchlist
 */
router.put(
  "/:id",
  validate({ params: watchlistIdParamSchema, body: watchlistUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { name } = req.body;

    const watchlist = await prisma.watchlist.update({
      where: { id: req.params.id },
      data: { name },
    });

    res.json(watchlist);
  })
);

/**
 * DELETE /api/watchlists/:id
 * Delete a watchlist
 */
router.delete(
  "/:id",
  validate({ params: watchlistIdParamSchema }),
  asyncHandler(async (req, res) => {
    await prisma.watchlist.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  })
);

/**
 * POST /api/watchlists/:id/items
 * Add item to watchlist
 */
router.post(
  "/:id/items",
  validate({ params: watchlistIdParamSchema, body: watchlistItemCreateSchema }),
  asyncHandler(async (req, res) => {
    const { symbol, conId, secType, source } = req.body;

    // Verify watchlist exists
    const watchlist = await prisma.watchlist.findUnique({
      where: { id: req.params.id },
    });

    if (!watchlist) {
      throw new NotFoundError("Watchlist not found");
    }

    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId: req.params.id,
        symbol,
        conId: conId || null,
        secType: secType || "STK",
        source: source || "manual",
      },
    });

    res.status(201).json(item);
  })
);

/**
 * DELETE /api/watchlists/:id/items/:itemId
 * Remove item from watchlist
 */
router.delete(
  "/:id/items/:itemId",
  validate({ params: watchlistItemIdParamSchema }),
  asyncHandler(async (req, res) => {
    await prisma.watchlistItem.delete({
      where: { id: req.params.itemId },
    });
    res.status(204).send();
  })
);

/**
 * PATCH /api/watchlists/:id/items/reorder
 * Batch update sort order for items
 */
router.patch(
  "/:id/items/reorder",
  validate({ params: watchlistIdParamSchema, body: watchlistReorderSchema }),
  asyncHandler(async (req, res) => {
    const { items } = req.body;
    const watchlistId = req.params.id;
    await prisma.$transaction(
      items.map((item: { id: string; sortOrder: number }) =>
        prisma.watchlistItem.update({
          where: { id: item.id, watchlistId },
          data: { sortOrder: item.sortOrder },
        })
      )
    );
    res.json({ ok: true });
  })
);

/**
 * PATCH /api/watchlists/:id/items/:itemId/move
 * Move an item to a different watchlist
 */
router.patch(
  "/:id/items/:itemId/move",
  validate({ params: watchlistItemIdParamSchema, body: watchlistMoveItemSchema }),
  asyncHandler(async (req, res) => {
    const { targetWatchlistId } = req.body;
    const target = await prisma.watchlist.findUnique({ where: { id: targetWatchlistId } });
    if (!target) throw new NotFoundError("Watchlist", targetWatchlistId);

    const item = await prisma.watchlistItem.findFirst({
      where: { id: req.params.itemId, watchlistId: req.params.id },
    });
    if (!item) throw new NotFoundError("WatchlistItem", req.params.itemId);

    const existing = await prisma.watchlistItem.findFirst({
      where: { watchlistId: targetWatchlistId, symbol: item.symbol },
    });
    if (existing) {
      await prisma.watchlistItem.delete({ where: { id: req.params.itemId } });
      res.json(existing);
      return;
    }

    const updated = await prisma.watchlistItem.update({
      where: { id: req.params.itemId },
      data: { watchlistId: targetWatchlistId },
    });
    res.json(updated);
  })
);

export default router;
