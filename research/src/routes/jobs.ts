import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { jobService } from "../services/job.service.js";
import { NotFoundError } from "../errors/AppError.js";

const router = Router();

const jobIdParamsSchema = z.object({
  jobId: z.string().uuid(),
});

const jobListQuerySchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /api/jobs
 * List recent jobs
 */
router.get(
  "/",
  validate({ query: jobListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { status, limit } = req.query as unknown as { status?: string; limit: number };
    const jobs = await jobService.list({ status, limit });
    res.json(jobs);
  })
);

/**
 * GET /api/jobs/:jobId
 * Get job status
 */
router.get(
  "/:jobId",
  validate({ params: jobIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const job = await jobService.get(req.params.jobId);
    if (!job) throw new NotFoundError("Job", req.params.jobId);
    res.json(job);
  })
);

export default router;
