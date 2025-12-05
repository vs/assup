import { Router, Request, Response } from "express";
import { prisma } from "../db/index.js";

const router = Router();

// GET /api/asset-classes - List all asset classes
router.get("/", async (req: Request, res: Response) => {
  try {
    const assetClasses = await prisma.assetClass.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { securityAssignments: true },
        },
      },
    });
    res.json(assetClasses);
  } catch (error) {
    console.error("Failed to fetch asset classes:", error);
    res.status(500).json({ error: "Failed to fetch asset classes" });
  }
});

// GET /api/asset-classes/:id - Get single asset class
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const assetClass = await prisma.assetClass.findUnique({
      where: { id: req.params.id },
      include: {
        securityAssignments: true,
        allocationTargets: {
          include: { allocationProfile: true },
        },
      },
    });
    if (!assetClass) {
      res.status(404).json({ error: "Asset class not found" });
      return;
    }
    res.json(assetClass);
  } catch (error) {
    console.error("Failed to fetch asset class:", error);
    res.status(500).json({ error: "Failed to fetch asset class" });
  }
});

// POST /api/asset-classes - Create asset class
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, description, color } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    const assetClass = await prisma.assetClass.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        color: color || "#6366f1",
      },
    });
    res.status(201).json(assetClass);
  } catch (error: any) {
    if (error.code === "P2002") {
      res.status(409).json({ error: "Asset class with this name already exists" });
      return;
    }
    console.error("Failed to create asset class:", error);
    res.status(500).json({ error: "Failed to create asset class" });
  }
});

// PUT /api/asset-classes/:id - Update asset class
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { name, description, color } = req.body;
    const data: { name?: string; description?: string | null; color?: string } = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Name cannot be empty" });
        return;
      }
      data.name = name.trim();
    }
    if (description !== undefined) {
      data.description = description?.trim() || null;
    }
    if (color !== undefined) {
      data.color = color;
    }

    const assetClass = await prisma.assetClass.update({
      where: { id: req.params.id },
      data,
    });
    res.json(assetClass);
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Asset class not found" });
      return;
    }
    if (error.code === "P2002") {
      res.status(409).json({ error: "Asset class with this name already exists" });
      return;
    }
    console.error("Failed to update asset class:", error);
    res.status(500).json({ error: "Failed to update asset class" });
  }
});

// DELETE /api/asset-classes/:id - Delete asset class
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.assetClass.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Asset class not found" });
      return;
    }
    console.error("Failed to delete asset class:", error);
    res.status(500).json({ error: "Failed to delete asset class" });
  }
});

export default router;
