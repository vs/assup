/**
 * Security Assignments API routes
 * Manages assignments of securities to asset classes
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { sseService } from "../services/sse.js";
import {
  securityAssignmentCreateSchema,
  securityAssignmentUpdateSchema,
  securityAssignmentIdParamSchema,
  securityAssignmentSymbolParamSchema,
  securityAssignmentSymbolQuerySchema,
  securityAssignmentBulkSchema,
} from "@assup/shared";
import { NotFoundError, BadRequestError } from "../errors/index.js";
import { z } from "zod";

const router = Router();

/**
 * GET /api/security-assignments
 * List all assignments with asset class info
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const assignments = await prisma.securityAssignment.findMany({
      orderBy: { symbol: "asc" },
      include: { assetClass: true },
    });
    res.json(assignments);
  })
);

/**
 * GET /api/security-assignments/:symbol
 * Get assignment for a specific symbol
 */
router.get(
  "/:symbol",
  validate({
    params: securityAssignmentSymbolParamSchema,
    query: securityAssignmentSymbolQuerySchema,
  }),
  asyncHandler(async (req, res) => {
    const { symbol } = req.params;
    const secType = (req.query.secType as string) || "STK";

    const assignment = await prisma.securityAssignment.findUnique({
      where: {
        symbol_secType: { symbol: symbol.toUpperCase(), secType },
      },
      include: { assetClass: true },
    });

    if (!assignment) {
      throw new NotFoundError("Security assignment not found");
    }

    res.json(assignment);
  })
);

/**
 * POST /api/security-assignments
 * Create or update a security assignment
 */
router.post(
  "/",
  validate({ body: securityAssignmentCreateSchema }),
  asyncHandler(async (req, res) => {
    const { symbol, conId, secType, assetClassId, source } = req.body;

    // Verify asset class exists
    const assetClass = await prisma.assetClass.findUnique({
      where: { id: assetClassId },
    });

    if (!assetClass) {
      throw new BadRequestError("Asset class not found");
    }

    const assignment = await prisma.securityAssignment.upsert({
      where: {
        symbol_secType: { symbol, secType },
      },
      update: {
        assetClassId,
        conId: conId || null,
        source: source || "manual",
      },
      create: {
        symbol,
        conId: conId || null,
        secType,
        assetClassId,
        source: source || "manual",
      },
      include: { assetClass: true },
    });

    sseService.broadcast("allocation", { changed: true, symbol });
    res.status(201).json(assignment);
  })
);

/**
 * PUT /api/security-assignments/:id
 * Update an existing assignment
 */
router.put(
  "/:id",
  validate({
    params: securityAssignmentIdParamSchema,
    body: securityAssignmentUpdateSchema,
  }),
  asyncHandler(async (req, res) => {
    const { assetClassId } = req.body;

    // Verify asset class exists
    const assetClass = await prisma.assetClass.findUnique({
      where: { id: assetClassId },
    });

    if (!assetClass) {
      throw new BadRequestError("Asset class not found");
    }

    const assignment = await prisma.securityAssignment.update({
      where: { id: req.params.id },
      data: { assetClassId },
      include: { assetClass: true },
    });

    sseService.broadcast("allocation", { changed: true, symbol: assignment.symbol });
    res.json(assignment);
  })
);

/**
 * DELETE /api/security-assignments/:id
 * Delete an assignment
 */
router.delete(
  "/:id",
  validate({ params: securityAssignmentIdParamSchema }),
  asyncHandler(async (req, res) => {
    const deleted = await prisma.securityAssignment.delete({
      where: { id: req.params.id },
    });

    sseService.broadcast("allocation", { changed: true, symbol: deleted.symbol });
    res.status(204).send();
  })
);

/**
 * POST /api/security-assignments/bulk
 * Bulk assign securities to asset classes
 */
router.post(
  "/bulk",
  validate({ body: z.object({ assignments: securityAssignmentBulkSchema }) }),
  asyncHandler(async (req, res) => {
    const { assignments } = req.body;

    const results = await prisma.$transaction(
      assignments.map((a: { symbol: string; conId?: number; secType: string; assetClassId: string; source?: string }) =>
        prisma.securityAssignment.upsert({
          where: {
            symbol_secType: { symbol: a.symbol, secType: a.secType },
          },
          update: {
            assetClassId: a.assetClassId,
            conId: a.conId || null,
            source: a.source || "bulk",
          },
          create: {
            symbol: a.symbol,
            conId: a.conId || null,
            secType: a.secType,
            assetClassId: a.assetClassId,
            source: a.source || "bulk",
          },
        })
      )
    );

    res.status(201).json({ created: results.length });
  })
);

export default router;
