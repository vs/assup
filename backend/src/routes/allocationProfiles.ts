/**
 * Allocation Profiles API routes
 * Manages allocation profiles and their target distributions
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import {
  allocationProfileCreateSchema,
  allocationProfileUpdateSchema,
  allocationProfileIdParamSchema,
} from "@assup/shared";
import { NotFoundError, BadRequestError } from "../errors/index.js";

const router = Router();

/**
 * Validate that target percentages sum to 100%
 */
function validateTargetsSum(targets: Array<{ targetPercentage: number }> | undefined): void {
  if (!targets || targets.length === 0) return;

  const total = targets.reduce((sum, t) => sum + t.targetPercentage, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new BadRequestError(
      `Target percentages must sum to 100% (current: ${total.toFixed(2)}%)`
    );
  }
}

/**
 * GET /api/allocation-profiles
 * List all profiles with targets
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
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
  })
);

/**
 * GET /api/allocation-profiles/active
 * Get the currently active profile
 */
router.get(
  "/active",
  asyncHandler(async (req, res) => {
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
      throw new NotFoundError("No active allocation profile");
    }

    res.json(profile);
  })
);

/**
 * GET /api/allocation-profiles/:id
 * Get a specific profile
 */
router.get(
  "/:id",
  validate({ params: allocationProfileIdParamSchema }),
  asyncHandler(async (req, res) => {
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
      throw new NotFoundError("Allocation profile not found");
    }

    res.json(profile);
  })
);

/**
 * POST /api/allocation-profiles
 * Create a new profile
 */
router.post(
  "/",
  validate({ body: allocationProfileCreateSchema }),
  asyncHandler(async (req, res) => {
    const { name, isActive, targets } = req.body;

    validateTargetsSum(targets);

    // If setting as active, deactivate others
    if (isActive) {
      await prisma.allocationProfile.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }

    const profile = await prisma.allocationProfile.create({
      data: {
        name,
        isActive: isActive || false,
        targets: targets
          ? {
              create: targets.map((t: { assetClassId: string; targetPercentage: number }) => ({
                assetClassId: t.assetClassId,
                targetPercentage: t.targetPercentage,
              })),
            }
          : undefined,
      },
      include: {
        targets: { include: { assetClass: true } },
      },
    });

    res.status(201).json(profile);
  })
);

/**
 * PUT /api/allocation-profiles/:id
 * Update a profile
 */
router.put(
  "/:id",
  validate({ params: allocationProfileIdParamSchema, body: allocationProfileUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { name, isActive, targets } = req.body;
    const profileId = req.params.id;

    // Check profile exists
    const existing = await prisma.allocationProfile.findUnique({
      where: { id: profileId },
    });

    if (!existing) {
      throw new NotFoundError("Allocation profile not found");
    }

    validateTargetsSum(targets);

    // If setting as active, deactivate others
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
          name,
          isActive,
          targets: targets
            ? {
                create: targets.map((t: { assetClassId: string; targetPercentage: number }) => ({
                  assetClassId: t.assetClassId,
                  targetPercentage: t.targetPercentage,
                })),
              }
            : undefined,
        },
        include: {
          targets: { include: { assetClass: true } },
        },
      });
    });

    res.json(profile);
  })
);

/**
 * POST /api/allocation-profiles/:id/activate
 * Set a profile as active
 */
router.post(
  "/:id/activate",
  validate({ params: allocationProfileIdParamSchema }),
  asyncHandler(async (req, res) => {
    const profileId = req.params.id;

    // Check profile exists
    const existing = await prisma.allocationProfile.findUnique({
      where: { id: profileId },
    });

    if (!existing) {
      throw new NotFoundError("Allocation profile not found");
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

    const profile = await prisma.allocationProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: {
        targets: { include: { assetClass: true } },
      },
    });

    res.json(profile);
  })
);

/**
 * DELETE /api/allocation-profiles/:id
 * Delete a profile
 */
router.delete(
  "/:id",
  validate({ params: allocationProfileIdParamSchema }),
  asyncHandler(async (req, res) => {
    await prisma.allocationProfile.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  })
);

export default router;
