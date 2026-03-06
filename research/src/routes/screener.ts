import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { screenerService } from "../services/screener.service.js";
import { jobService } from "../services/job.service.js";
import {
  createScreenerSchema,
  updateScreenerSchema,
  screenerIdParamsSchema,
  screenerResultsQuerySchema,
} from "../schemas/screener.schema.js";

const router = Router();

/**
 * GET /api/screener/configs
 * List all screener configs
 */
router.get(
  "/configs",
  asyncHandler(async (_req, res) => {
    const configs = await screenerService.listConfigs();
    res.json(configs);
  })
);

/**
 * POST /api/screener/configs
 * Create a new screener config
 */
router.post(
  "/configs",
  validate({ body: createScreenerSchema }),
  asyncHandler(async (req, res) => {
    const config = await screenerService.createConfig(req.body);
    res.status(201).json(config);
  })
);

/**
 * GET /api/screener/configs/:id
 * Get a single screener config
 */
router.get(
  "/configs/:id",
  validate({ params: screenerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const config = await screenerService.getConfig(id);
    res.json(config);
  })
);

/**
 * PATCH /api/screener/configs/:id
 * Update a screener config
 */
router.patch(
  "/configs/:id",
  validate({ params: screenerIdParamsSchema, body: updateScreenerSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    const config = await screenerService.updateConfig(id, req.body);
    res.json(config);
  })
);

/**
 * DELETE /api/screener/configs/:id
 * Delete a screener config
 */
router.delete(
  "/configs/:id",
  validate({ params: screenerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };
    await screenerService.deleteConfig(id);
    res.status(204).send();
  })
);

/**
 * POST /api/screener/configs/:id/run
 * Trigger a manual screener run (async, returns 202 with jobId)
 */
router.post(
  "/configs/:id/run",
  validate({ params: screenerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as { id: string };

    // Verify config exists before creating job
    await screenerService.getConfig(id);

    const job = await jobService.create("screener_run", id);

    // Run screener in background (don't await)
    (async () => {
      try {
        await jobService.start(job.id);
        const result = await screenerService.runScreener(id);
        await jobService.complete(job.id, result);
      } catch (err) {
        await jobService.fail(job.id, (err as Error).message);
      }
    })();

    res.status(202).json({ jobId: job.id });
  })
);

/**
 * GET /api/screener/results
 * List recent screener-discovered tickers
 */
router.get(
  "/results",
  validate({ query: screenerResultsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as {
      page: number;
      limit: number;
    };
    const results = await screenerService.getResults({ page, limit });
    res.json(results);
  })
);

export default router;
