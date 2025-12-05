import { Router, Request, Response } from "express";
import { prisma } from "../db/index.js";
import { sseService } from "../services/sse.js";

const router = Router();

// GET /api/security-assignments - List all assignments
router.get("/", async (req: Request, res: Response) => {
  try {
    const assignments = await prisma.securityAssignment.findMany({
      orderBy: { symbol: "asc" },
      include: { assetClass: true },
    });
    res.json(assignments);
  } catch (error) {
    console.error("Failed to fetch security assignments:", error);
    res.status(500).json({ error: "Failed to fetch security assignments" });
  }
});

// GET /api/security-assignments/:symbol - Get assignment for a symbol
router.get("/:symbol", async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const secType = (req.query.secType as string) || "STK";

    const assignment = await prisma.securityAssignment.findUnique({
      where: {
        symbol_secType: { symbol: symbol.toUpperCase(), secType },
      },
      include: { assetClass: true },
    });

    if (!assignment) {
      res.status(404).json({ error: "Security assignment not found" });
      return;
    }
    res.json(assignment);
  } catch (error) {
    console.error("Failed to fetch security assignment:", error);
    res.status(500).json({ error: "Failed to fetch security assignment" });
  }
});

// POST /api/security-assignments - Create or update assignment
router.post("/", async (req: Request, res: Response) => {
  try {
    const { symbol, conId, secType, assetClassId, source } = req.body;

    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "Symbol is required" });
      return;
    }
    if (!assetClassId) {
      res.status(400).json({ error: "Asset class ID is required" });
      return;
    }

    // Verify asset class exists
    const assetClass = await prisma.assetClass.findUnique({
      where: { id: assetClassId },
    });
    if (!assetClass) {
      res.status(400).json({ error: "Asset class not found" });
      return;
    }

    const assignment = await prisma.securityAssignment.upsert({
      where: {
        symbol_secType: {
          symbol: symbol.toUpperCase(),
          secType: secType || "STK",
        },
      },
      update: {
        assetClassId,
        conId: conId || null,
        source: source || "manual",
      },
      create: {
        symbol: symbol.toUpperCase(),
        conId: conId || null,
        secType: secType || "STK",
        assetClassId,
        source: source || "manual",
      },
      include: { assetClass: true },
    });

    // Broadcast allocation change
    sseService.broadcast("allocation", { changed: true, symbol: symbol.toUpperCase() });

    res.status(201).json(assignment);
  } catch (error) {
    console.error("Failed to create security assignment:", error);
    res.status(500).json({ error: "Failed to create security assignment" });
  }
});

// PUT /api/security-assignments/:id - Update assignment
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { assetClassId } = req.body;

    if (!assetClassId) {
      res.status(400).json({ error: "Asset class ID is required" });
      return;
    }

    // Verify asset class exists
    const assetClass = await prisma.assetClass.findUnique({
      where: { id: assetClassId },
    });
    if (!assetClass) {
      res.status(400).json({ error: "Asset class not found" });
      return;
    }

    const assignment = await prisma.securityAssignment.update({
      where: { id: req.params.id },
      data: { assetClassId },
      include: { assetClass: true },
    });

    // Broadcast allocation change
    sseService.broadcast("allocation", { changed: true, symbol: assignment.symbol });

    res.json(assignment);
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Security assignment not found" });
      return;
    }
    console.error("Failed to update security assignment:", error);
    res.status(500).json({ error: "Failed to update security assignment" });
  }
});

// DELETE /api/security-assignments/:id - Delete assignment
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await prisma.securityAssignment.delete({
      where: { id: req.params.id },
    });

    // Broadcast allocation change
    sseService.broadcast("allocation", { changed: true, symbol: deleted.symbol });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Security assignment not found" });
      return;
    }
    console.error("Failed to delete security assignment:", error);
    res.status(500).json({ error: "Failed to delete security assignment" });
  }
});

// POST /api/security-assignments/bulk - Bulk assign securities
router.post("/bulk", async (req: Request, res: Response) => {
  try {
    const { assignments } = req.body;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      res.status(400).json({ error: "Assignments array is required" });
      return;
    }

    const results = await prisma.$transaction(
      assignments.map((a: any) =>
        prisma.securityAssignment.upsert({
          where: {
            symbol_secType: {
              symbol: a.symbol.toUpperCase(),
              secType: a.secType || "STK",
            },
          },
          update: {
            assetClassId: a.assetClassId,
            conId: a.conId || null,
            source: a.source || "bulk",
          },
          create: {
            symbol: a.symbol.toUpperCase(),
            conId: a.conId || null,
            secType: a.secType || "STK",
            assetClassId: a.assetClassId,
            source: a.source || "bulk",
          },
        })
      )
    );

    res.status(201).json({ created: results.length });
  } catch (error) {
    console.error("Failed to bulk assign securities:", error);
    res.status(500).json({ error: "Failed to bulk assign securities" });
  }
});

export default router;
