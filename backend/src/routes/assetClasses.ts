/**
 * Asset Classes API routes
 * CRUD operations for asset class management
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import {
  assetClassCreateSchema,
  assetClassUpdateSchema,
  assetClassIdParamSchema,
} from "@assup/shared";

const router = Router();

/**
 * GET /api/asset-classes
 * List all asset classes with security assignment counts
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const assetClasses = await prisma.assetClass.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { securityAssignments: true },
        },
      },
    });
    res.json(assetClasses);
  })
);

/**
 * GET /api/asset-classes/:id
 * Get single asset class with related data
 */
router.get(
  "/:id",
  validate({ params: assetClassIdParamSchema }),
  asyncHandler(async (req, res) => {
    const assetClass = await prisma.assetClass.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        securityAssignments: true,
        allocationTargets: {
          include: { allocationProfile: true },
        },
      },
    });
    res.json(assetClass);
  })
);

/**
 * POST /api/asset-classes
 * Create a new asset class
 */
router.post(
  "/",
  validate({ body: assetClassCreateSchema }),
  asyncHandler(async (req, res) => {
    const { name, description, color } = req.body;

    const assetClass = await prisma.assetClass.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        color: color || "#6366f1",
      },
    });

    res.status(201).json(assetClass);
  })
);

/**
 * PUT /api/asset-classes/:id
 * Update an existing asset class
 */
router.put(
  "/:id",
  validate({ params: assetClassIdParamSchema, body: assetClassUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { name, description, color } = req.body;
    const data: { name?: string; description?: string | null; color?: string } = {};

    if (name !== undefined) {
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
  })
);

/**
 * DELETE /api/asset-classes/:id
 * Delete an asset class
 */
router.delete(
  "/:id",
  validate({ params: assetClassIdParamSchema }),
  asyncHandler(async (req, res) => {
    await prisma.assetClass.delete({
      where: { id: req.params.id },
    });
    res.status(204).send();
  })
);

export default router;
