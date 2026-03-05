import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../errors/AppError.js";

const router = Router();

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /api/macro
 * Latest macro regime analysis
 */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const snapshot = await prisma.macroSnapshot.findFirst({
      orderBy: { analyzedAt: "desc" },
    });
    if (!snapshot) throw new NotFoundError("Macro snapshot");
    res.json(snapshot);
  })
);

/**
 * GET /api/macro/history
 * Historical macro snapshots
 */
router.get(
  "/history",
  validate({ query: historyQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };

    const [snapshots, total] = await Promise.all([
      prisma.macroSnapshot.findMany({
        orderBy: { analyzedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.macroSnapshot.count(),
    ]);

    res.json({ snapshots, total });
  })
);

export default router;
