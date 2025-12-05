import { Router, Request, Response } from "express";
import { prisma } from "../db/index.js";

const router = Router();

// GET /api/watchlists - List all watchlists
router.get("/", async (req: Request, res: Response) => {
  try {
    const watchlists = await prisma.watchlist.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { items: true } },
      },
    });
    res.json(watchlists);
  } catch (error) {
    console.error("Failed to fetch watchlists:", error);
    res.status(500).json({ error: "Failed to fetch watchlists" });
  }
});

// GET /api/watchlists/:id - Get watchlist with items
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const watchlist = await prisma.watchlist.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          orderBy: { addedAt: "desc" },
        },
      },
    });
    if (!watchlist) {
      res.status(404).json({ error: "Watchlist not found" });
      return;
    }

    // Enrich items with security assignments
    const assignments = await prisma.securityAssignment.findMany({
      include: { assetClass: true },
    });
    const assignmentMap = new Map(
      assignments.map((a) => [`${a.symbol}:${a.secType}`, a])
    );

    const enrichedItems = watchlist.items.map((item) => {
      const assignment = assignmentMap.get(`${item.symbol}:${item.secType}`);
      return {
        ...item,
        assetClassId: assignment?.assetClassId || null,
        assetClassName: assignment?.assetClass.name || null,
        assetClassColor: assignment?.assetClass.color || null,
      };
    });

    res.json({ ...watchlist, items: enrichedItems });
  } catch (error) {
    console.error("Failed to fetch watchlist:", error);
    res.status(500).json({ error: "Failed to fetch watchlist" });
  }
});

// POST /api/watchlists - Create watchlist
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const watchlist = await prisma.watchlist.create({
      data: { name: name.trim() },
    });
    res.status(201).json(watchlist);
  } catch (error) {
    console.error("Failed to create watchlist:", error);
    res.status(500).json({ error: "Failed to create watchlist" });
  }
});

// PUT /api/watchlists/:id - Update watchlist
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const watchlist = await prisma.watchlist.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });
    res.json(watchlist);
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Watchlist not found" });
      return;
    }
    console.error("Failed to update watchlist:", error);
    res.status(500).json({ error: "Failed to update watchlist" });
  }
});

// DELETE /api/watchlists/:id - Delete watchlist
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.watchlist.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Watchlist not found" });
      return;
    }
    console.error("Failed to delete watchlist:", error);
    res.status(500).json({ error: "Failed to delete watchlist" });
  }
});

// POST /api/watchlists/:id/items - Add item to watchlist
router.post("/:id/items", async (req: Request, res: Response) => {
  try {
    const { symbol, conId, secType } = req.body;
    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "Symbol is required" });
      return;
    }

    // Check watchlist exists
    const watchlist = await prisma.watchlist.findUnique({
      where: { id: req.params.id },
    });
    if (!watchlist) {
      res.status(404).json({ error: "Watchlist not found" });
      return;
    }

    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId: req.params.id,
        symbol: symbol.toUpperCase(),
        conId: conId || null,
        secType: secType || "STK",
      },
    });
    res.status(201).json(item);
  } catch (error: any) {
    if (error.code === "P2002") {
      res.status(409).json({ error: "Symbol already in watchlist" });
      return;
    }
    console.error("Failed to add watchlist item:", error);
    res.status(500).json({ error: "Failed to add watchlist item" });
  }
});

// DELETE /api/watchlists/:id/items/:itemId - Remove item from watchlist
router.delete("/:id/items/:itemId", async (req: Request, res: Response) => {
  try {
    await prisma.watchlistItem.delete({
      where: { id: req.params.itemId },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Watchlist item not found" });
      return;
    }
    console.error("Failed to remove watchlist item:", error);
    res.status(500).json({ error: "Failed to remove watchlist item" });
  }
});

export default router;
