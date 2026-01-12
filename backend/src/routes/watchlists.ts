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
      orderBy: { name: "asc" },
      include: {
        _count: { select: { items: true } },
      },
    });
    res.json(watchlists);
  })
);

/**
 * GET /api/watchlists/:id
 * Get watchlist with enriched items
 */
router.get(
  "/:id",
  validate({ params: watchlistIdParamSchema }),
  asyncHandler(async (req, res) => {
    const watchlist = await prisma.watchlist.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: { addedAt: "desc" } },
      },
    });

    if (!watchlist) {
      throw new NotFoundError("Watchlist not found");
    }

    // Enrich items with asset class info
    const assignmentMap = await assignmentService.getAssignmentMap();
    const enrichedItems = watchlist.items.map((item) => {
      const assignment = assignmentMap.get(getSecurityKey(item.symbol, item.secType));
      return {
        ...item,
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
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
    const { symbol, conId, secType } = req.body;

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

export default router;
