import { Router, Request, Response } from "express";
import { prisma } from "../db/index.js";

const router = Router();

// GET /api/allocation-profiles - List all profiles
router.get("/", async (req: Request, res: Response) => {
  try {
    const profiles = await prisma.allocationProfile.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        targets: {
          include: { assetClass: true },
          orderBy: { targetPercentage: "desc" },
        },
      },
    });
    res.json(profiles);
  } catch (error) {
    console.error("Failed to fetch allocation profiles:", error);
    res.status(500).json({ error: "Failed to fetch allocation profiles" });
  }
});

// GET /api/allocation-profiles/active - Get active profile
router.get("/active", async (req: Request, res: Response) => {
  try {
    const profile = await prisma.allocationProfile.findFirst({
      where: { isActive: true },
      include: {
        targets: {
          include: { assetClass: true },
          orderBy: { targetPercentage: "desc" },
        },
      },
    });
    if (!profile) {
      res.status(404).json({ error: "No active allocation profile" });
      return;
    }
    res.json(profile);
  } catch (error) {
    console.error("Failed to fetch active profile:", error);
    res.status(500).json({ error: "Failed to fetch active profile" });
  }
});

// GET /api/allocation-profiles/:id - Get single profile
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const profile = await prisma.allocationProfile.findUnique({
      where: { id: req.params.id },
      include: {
        targets: {
          include: { assetClass: true },
          orderBy: { targetPercentage: "desc" },
        },
      },
    });
    if (!profile) {
      res.status(404).json({ error: "Allocation profile not found" });
      return;
    }
    res.json(profile);
  } catch (error) {
    console.error("Failed to fetch allocation profile:", error);
    res.status(500).json({ error: "Failed to fetch allocation profile" });
  }
});

// POST /api/allocation-profiles - Create profile
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, isActive, targets } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    // Validate targets if provided
    if (targets && Array.isArray(targets)) {
      const total = targets.reduce((sum: number, t: any) => sum + (t.targetPercentage || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        res.status(400).json({ error: `Target percentages must sum to 100% (current: ${total.toFixed(2)}%)` });
        return;
      }
    }

    // If setting as active, deactivate others first
    if (isActive) {
      await prisma.allocationProfile.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }

    const profile = await prisma.allocationProfile.create({
      data: {
        name: name.trim(),
        isActive: isActive || false,
        targets: targets
          ? {
              create: targets.map((t: any) => ({
                assetClassId: t.assetClassId,
                targetPercentage: t.targetPercentage,
              })),
            }
          : undefined,
      },
      include: {
        targets: {
          include: { assetClass: true },
        },
      },
    });

    res.status(201).json(profile);
  } catch (error) {
    console.error("Failed to create allocation profile:", error);
    res.status(500).json({ error: "Failed to create allocation profile" });
  }
});

// PUT /api/allocation-profiles/:id - Update profile
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { name, isActive, targets } = req.body;
    const profileId = req.params.id;

    // Check profile exists
    const existing = await prisma.allocationProfile.findUnique({
      where: { id: profileId },
    });
    if (!existing) {
      res.status(404).json({ error: "Allocation profile not found" });
      return;
    }

    // Validate targets if provided
    if (targets && Array.isArray(targets)) {
      const total = targets.reduce((sum: number, t: any) => sum + (t.targetPercentage || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        res.status(400).json({ error: `Target percentages must sum to 100% (current: ${total.toFixed(2)}%)` });
        return;
      }
    }

    // If setting as active, deactivate others first
    if (isActive && !existing.isActive) {
      await prisma.allocationProfile.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }

    // Update profile and targets in transaction
    const profile = await prisma.$transaction(async (tx) => {
      // Delete existing targets if new ones provided
      if (targets) {
        await tx.allocationTarget.deleteMany({
          where: { allocationProfileId: profileId },
        });
      }

      return tx.allocationProfile.update({
        where: { id: profileId },
        data: {
          name: name?.trim(),
          isActive: isActive,
          targets: targets
            ? {
                create: targets.map((t: any) => ({
                  assetClassId: t.assetClassId,
                  targetPercentage: t.targetPercentage,
                })),
              }
            : undefined,
        },
        include: {
          targets: {
            include: { assetClass: true },
          },
        },
      });
    });

    res.json(profile);
  } catch (error) {
    console.error("Failed to update allocation profile:", error);
    res.status(500).json({ error: "Failed to update allocation profile" });
  }
});

// POST /api/allocation-profiles/:id/activate - Set profile as active
router.post("/:id/activate", async (req: Request, res: Response) => {
  try {
    const profileId = req.params.id;

    // Check profile exists
    const existing = await prisma.allocationProfile.findUnique({
      where: { id: profileId },
    });
    if (!existing) {
      res.status(404).json({ error: "Allocation profile not found" });
      return;
    }

    // Deactivate all and activate this one
    await prisma.$transaction([
      prisma.allocationProfile.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      prisma.allocationProfile.update({
        where: { id: profileId },
        data: { isActive: true },
      }),
    ]);

    const profile = await prisma.allocationProfile.findUnique({
      where: { id: profileId },
      include: {
        targets: {
          include: { assetClass: true },
        },
      },
    });

    res.json(profile);
  } catch (error) {
    console.error("Failed to activate allocation profile:", error);
    res.status(500).json({ error: "Failed to activate allocation profile" });
  }
});

// DELETE /api/allocation-profiles/:id - Delete profile
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.allocationProfile.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "Allocation profile not found" });
      return;
    }
    console.error("Failed to delete allocation profile:", error);
    res.status(500).json({ error: "Failed to delete allocation profile" });
  }
});

export default router;
