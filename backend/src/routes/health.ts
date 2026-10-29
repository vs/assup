/**
 * Health check route
 */

import { Router } from "express";
import { prisma } from "../db/index.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ibkrService } from "../services/ibkr.js";

const router = Router();

/**
 * GET /api/health
 * Returns 200 whenever the backend and database are up. TWS being disconnected is
 * reported in `ibkr` but is not a failure: the frontend, the desktop app and the
 * Docker healthcheck all use this endpoint to find the backend.
 */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const assetClassCount = await prisma.assetClass.count();
    // The account id is left out on purpose; healthcheck output tends to end up in logs.
    const { connected, serverVersion, error } = ibkrService.getStatus();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: { connected: true, assetClasses: assetClassCount },
      ibkr: { connected, serverVersion, error },
    });
  }),
);

export default router;
