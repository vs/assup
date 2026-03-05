import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { tickerService } from "../services/ticker.service.js";
import {
  addTickersSchema,
  tickerParamsSchema,
  updateTickerSchema,
  tickerListQuerySchema,
} from "../schemas/ticker.schema.js";

const router = Router();

/**
 * GET /api/tickers
 * List all tracked tickers
 */
router.get(
  "/",
  validate({ query: tickerListQuerySchema }),
  asyncHandler(async (req, res) => {
    const { status, source, page, limit } = req.query as unknown as {
      status?: string;
      source?: string;
      page: number;
      limit: number;
    };
    const result = await tickerService.list({ status, source, page, limit });
    res.json(result);
  })
);

/**
 * GET /api/tickers/:symbol
 * Get ticker details
 */
router.get(
  "/:symbol",
  validate({ params: tickerParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await tickerService.get(req.params.symbol);
    res.json(ticker);
  })
);

/**
 * POST /api/tickers
 * Add ticker(s) for analysis
 */
router.post(
  "/",
  validate({ body: addTickersSchema }),
  asyncHandler(async (req, res) => {
    const { symbols, source } = req.body;
    const result = await tickerService.add(symbols, source);
    res.status(201).json(result);
  })
);

/**
 * PATCH /api/tickers/:symbol
 * Update ticker status
 */
router.patch(
  "/:symbol",
  validate({ params: tickerParamsSchema, body: updateTickerSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await tickerService.update(req.params.symbol, req.body);
    res.json(ticker);
  })
);

/**
 * DELETE /api/tickers/:symbol
 * Remove ticker and all its data
 */
router.delete(
  "/:symbol",
  validate({ params: tickerParamsSchema }),
  asyncHandler(async (req, res) => {
    await tickerService.remove(req.params.symbol);
    res.status(204).send();
  })
);

export default router;
