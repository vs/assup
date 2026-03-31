/**
 * Research API routes
 * Direct service calls (replaces HTTP proxy to research microservice)
 */

import { Router } from "express";
import { execFile, spawn } from "node:child_process";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { prisma } from "../db/index.js";
import { tickerService } from "../services/research/ticker.service.js";
import { jobService } from "../services/research/job.service.js";
import { macroService } from "../services/research/macro.service.js";
import { pipelineService } from "../services/research/pipeline.service.js";
import { marketScannerService } from "../services/research/market-scanner.service.js";
import { schedulerService } from "../services/research/scheduler.service.js";
import {
  getAuthStatus,
  getOAuthToken,
  setOAuthToken,
  deleteOAuthToken,
} from "../services/research/auth.service.js";
import {
  getSAAuthStatus,
  setSACredentials,
  deleteSACredentials,
} from "../services/research/sa-auth.service.js";
import { fetchSAJson, closeBrowser as closeSABrowser, getBrowserStatus as getSABrowserStatus } from "../services/research/collectors/sa-browser.js";
import {
  addTickersSchema,
  tickerParamsSchema,
  updateTickerSchema,
  tickerListQuerySchema,
} from "../services/research/schemas/ticker.schema.js";
import { z } from "zod";
import { validate } from "../services/research/middleware/validate.js";
import { NotFoundError } from "../services/research/errors/AppError.js";

const router = Router();

// ── Helper: test Claude CLI ─────────────────────────────────────────

function testCli(prompt: string, oauthToken?: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    }
    const child = spawn("claude", ["--output-format", "json"], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "CLI timed out after 30s" });
    }, 30_000);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: stderr.trim() || `CLI exited with code ${code}`,
        });
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ══════════════════════════════════════════════════════════════════════
// STATIC ROUTES (must come before :symbol)
// ══════════════════════════════════════════════════════════════════════

// ── Macro ────────────────────────────────────────────────────────────

/**
 * GET /api/research/macro
 * Get latest macro regime snapshot
 */
router.get(
  "/macro",
  asyncHandler(async (_req, res) => {
    const snapshot = await prisma.macroSnapshot.findFirst({
      orderBy: { analyzedAt: "desc" },
    });
    if (!snapshot) throw new NotFoundError("Macro snapshot");
    res.json(snapshot);
  })
);

/**
 * POST /api/research/macro/refresh
 * Collect fresh macro data and return updated snapshot
 */
router.post(
  "/macro/refresh",
  asyncHandler(async (_req, res) => {
    const snapshot = await macroService.collectAndAnalyze(true);
    res.json(snapshot);
  })
);

/**
 * GET /api/research/macro/history
 * Paginated macro snapshot history
 */
router.get(
  "/macro/history",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20)
    );

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

// ── Tickers ──────────────────────────────────────────────────────────

/**
 * GET /api/research/tickers
 * List tracked tickers with optional filters
 */
router.get(
  "/tickers",
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
 * GET /api/research/tickers/:symbol
 * Get a single ticker
 */
router.get(
  "/tickers/:symbol",
  validate({ params: tickerParamsSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await tickerService.get(req.params.symbol);
    res.json(ticker);
  })
);

/**
 * POST /api/research/tickers
 * Add tickers for tracking
 */
router.post(
  "/tickers",
  validate({ body: addTickersSchema }),
  asyncHandler(async (req, res) => {
    const { symbols, source } = req.body;
    const result = await tickerService.add(symbols, source);
    res.status(201).json(result);
  })
);

/**
 * PATCH /api/research/tickers/:symbol
 * Update ticker status
 */
router.patch(
  "/tickers/:symbol",
  validate({ params: tickerParamsSchema, body: updateTickerSchema }),
  asyncHandler(async (req, res) => {
    const ticker = await tickerService.update(req.params.symbol, req.body);
    res.json(ticker);
  })
);

/**
 * DELETE /api/research/tickers/:symbol
 * Remove a ticker
 */
router.delete(
  "/tickers/:symbol",
  validate({ params: tickerParamsSchema }),
  asyncHandler(async (req, res) => {
    await tickerService.remove(req.params.symbol);
    res.status(204).end();
  })
);

// ── Sync Watchlist ───────────────────────────────────────────────────

/**
 * POST /api/research/sync-watchlist
 * Push all watchlist symbols to research tickers
 */
router.post(
  "/sync-watchlist",
  asyncHandler(async (_req, res) => {
    const items = await prisma.watchlistItem.findMany({
      select: { symbol: true },
      distinct: ["symbol"],
    });
    const symbols = items.map((i: { symbol: string }) => i.symbol);

    if (symbols.length === 0) {
      res.json({ synced: 0, skipped: 0 });
      return;
    }

    const result = await tickerService.add(symbols, "external");
    res.json({
      synced: result.added.length,
      skipped: result.skipped.length,
    });
  })
);

// ── Jobs ─────────────────────────────────────────────────────────────

/**
 * GET /api/research/jobs
 * List jobs with optional status filter
 */
router.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const rawLimit = parseInt(req.query.limit as string, 10) || 50;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const jobs = await jobService.list({ status, limit });
    res.json(jobs);
  })
);

/**
 * GET /api/research/jobs/:jobId
 * Get job status
 */
router.get(
  "/jobs/:jobId",
  asyncHandler(async (req, res) => {
    const job = await jobService.get(req.params.jobId);
    if (!job) throw new NotFoundError("Job", req.params.jobId);
    res.json(job);
  })
);

// ── Claude Status ────────────────────────────────────────────────────

/**
 * GET /api/research/claude-status
 * Check Claude CLI availability and auth status
 */
router.get(
  "/claude-status",
  asyncHandler(async (_req, res) => {
    // Check if claude CLI is installed
    const versionResult = await new Promise<{
      ok: boolean;
      version?: string;
      error?: string;
    }>((resolve) => {
      execFile("claude", ["--version"], (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: err.message });
        } else {
          resolve({ ok: true, version: stdout.trim() || stderr.trim() });
        }
      });
    });

    if (!versionResult.ok) {
      res.json({
        available: false,
        mode: "none",
        error: `Claude CLI not found: ${versionResult.error}`,
      });
      return;
    }

    // Test with a simple prompt using stored token if available
    const storedToken = await getOAuthToken();
    const testResult = await testCli("Reply with exactly: ok", storedToken ?? undefined);
    if (!testResult.ok) {
      res.json({
        available: false,
        mode: "cli",
        error: `Claude CLI not authenticated: ${testResult.error}`,
      });
      return;
    }

    res.json({ available: true, mode: "cli" });
  })
);

// ── Auth ─────────────────────────────────────────────────────────────

/**
 * GET /api/research/auth/status
 * Get OAuth token auth status
 */
router.get(
  "/auth/status",
  asyncHandler(async (_req, res) => {
    const status = await getAuthStatus();
    res.json(status);
  })
);

/**
 * PUT /api/research/auth/token
 * Validate and store OAuth token
 */
router.put(
  "/auth/token",
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    // Validate by testing the CLI with the provided token
    const testResult = await testCli("Reply with exactly: ok", token);
    if (!testResult.ok) {
      res.status(400).json({
        error: "Token validation failed",
        detail: testResult.error,
      });
      return;
    }

    await setOAuthToken(token);
    const status = await getAuthStatus();
    res.json(status);
  })
);

/**
 * DELETE /api/research/auth/token
 * Remove stored OAuth token
 */
router.delete(
  "/auth/token",
  asyncHandler(async (_req, res) => {
    await deleteOAuthToken();
    const status = await getAuthStatus();
    res.json(status);
  })
);

// ── Seeking Alpha Auth ───────────────────────────────────────────────

/**
 * GET /api/research/sa-auth/status
 * Get Seeking Alpha credentials status
 */
router.get(
  "/sa-auth/status",
  asyncHandler(async (_req, res) => {
    const status = await getSAAuthStatus();
    const browser = getSABrowserStatus();
    res.json({ ...status, browser });
  })
);

/**
 * PUT /api/research/sa-auth/credentials
 * Save Seeking Alpha credentials
 */
router.put(
  "/sa-auth/credentials",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    await setSACredentials(email.trim(), password);

    // Close existing browser session so the next collection uses the new credentials
    await closeSABrowser();

    const status = await getSAAuthStatus();
    res.json(status);
  })
);

/**
 * DELETE /api/research/sa-auth/credentials
 * Remove stored Seeking Alpha credentials
 */
router.delete(
  "/sa-auth/credentials",
  asyncHandler(async (_req, res) => {
    await deleteSACredentials();
    await closeSABrowser();
    const status = await getSAAuthStatus();
    res.json(status);
  })
);

/**
 * POST /api/research/sa-auth/test
 * Test Seeking Alpha connection by fetching AAPL ratings
 */
router.post(
  "/sa-auth/test",
  asyncHandler(async (_req, res) => {
    // Force a fresh browser session to pick up latest credentials
    await closeSABrowser();

    const ratings = await fetchSAJson(
      "https://seekingalpha.com/api/v3/symbols/aapl/rating/periods?filter[periods][]=0"
    );

    if (ratings) {
      const data = ratings as { data?: Array<{ attributes: { ratings: Record<string, unknown> }; meta: { is_locked?: boolean } }> };
      const hasRatings = Array.isArray(data.data) && data.data.length > 0;
      const isLocked = data.data?.[0]?.meta?.is_locked ?? true;
      res.json({
        ok: true,
        hasData: hasRatings,
        premium: !isLocked,
      });
    } else {
      res.json({ ok: false, hasData: false, premium: false });
    }
  })
);

// ── Scanner ──────────────────────────────────────────────────────────

const technicalFilterSchema = z.object({
  enabled: z.boolean(),
  trendPeriodYears: z.number().int().min(1).max(10).optional(),
  minSma200SlopeMonths: z.number().int().min(1).max(24).optional(),
  maxRsi: z.number().min(1).max(100).optional(),
  requireAboveSma200: z.boolean().optional(),
  require50Above200: z.boolean().optional(),
});

const createPresetSchema = z.object({
  name: z.string().min(1).max(100),
  scanCode: z.string().min(1),
  locationCode: z.string().max(40).optional(),
  filters: z.record(z.unknown()).optional(),
  technicalFilter: technicalFilterSchema.optional(),
  schedule: z.string().min(1).max(50),
  enabled: z.boolean().optional(),
});

const updatePresetSchema = createPresetSchema.partial();

const presetIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const scannerResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const adhocScanSchema = z.object({
  scanCode: z.string().min(1),
  locationCode: z.string().max(40).optional(),
  numberOfRows: z.number().int().min(1).max(100).optional(),
  abovePrice: z.number().positive().optional(),
  belowPrice: z.number().positive().optional(),
  aboveVolume: z.number().int().positive().optional(),
  marketCapAbove: z.number().positive().optional(),
  marketCapBelow: z.number().positive().optional(),
  averageOptionVolumeAbove: z.number().int().positive().optional(),
  stockTypeFilter: z.string().optional(),
  technicalFilter: technicalFilterSchema.optional(),
});

/**
 * GET /api/research/scanner/presets
 * List all scanner presets
 */
router.get(
  "/scanner/presets",
  asyncHandler(async (_req, res) => {
    const presets = await marketScannerService.listPresets();
    res.json(presets);
  })
);

/**
 * POST /api/research/scanner/presets
 * Create a new scanner preset
 */
router.post(
  "/scanner/presets",
  validate({ body: createPresetSchema }),
  asyncHandler(async (req, res) => {
    const preset = await marketScannerService.createPreset(req.body);
    await schedulerService.refreshScannerSchedules();
    res.status(201).json(preset);
  })
);

/**
 * GET /api/research/scanner/presets/:id
 * Get a scanner preset by ID
 */
router.get(
  "/scanner/presets/:id",
  validate({ params: presetIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const preset = await marketScannerService.getPreset(req.params.id);
    res.json(preset);
  })
);

/**
 * PATCH /api/research/scanner/presets/:id
 * Update a scanner preset
 */
router.patch(
  "/scanner/presets/:id",
  validate({ params: presetIdParamsSchema, body: updatePresetSchema }),
  asyncHandler(async (req, res) => {
    const preset = await marketScannerService.updatePreset(req.params.id, req.body);
    await schedulerService.refreshScannerSchedules();
    res.json(preset);
  })
);

/**
 * DELETE /api/research/scanner/presets/:id
 * Delete a scanner preset
 */
router.delete(
  "/scanner/presets/:id",
  validate({ params: presetIdParamsSchema }),
  asyncHandler(async (req, res) => {
    await marketScannerService.deletePreset(req.params.id);
    await schedulerService.refreshScannerSchedules();
    res.status(204).end();
  })
);

/**
 * POST /api/research/scanner/presets/:id/run
 * Run a scanner preset asynchronously
 * Returns 202 with jobId
 */
router.post(
  "/scanner/presets/:id/run",
  validate({ params: presetIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const presetId = req.params.id;

    // Verify preset exists
    const preset = await marketScannerService.getPreset(presetId);

    const job = await jobService.create("scanner_run", preset.name.slice(0, 20));

    // Run in background
    (async () => {
      try {
        await jobService.start(job.id);
        const result = await marketScannerService.runPreset(presetId);
        await jobService.complete(job.id, result as unknown as Record<string, unknown>);
      } catch (err) {
        await jobService.fail(job.id, (err as Error).message);
      }
    })();

    res.status(202).json({ jobId: job.id });
  })
);

/**
 * POST /api/research/scanner/scan
 * Run an ad-hoc scan synchronously
 * Returns results directly
 */
router.post(
  "/scanner/scan",
  validate({ body: adhocScanSchema }),
  asyncHandler(async (req, res) => {
    const { technicalFilter, ...scanParams } = req.body;
    const result = await marketScannerService.runAdhoc(scanParams, technicalFilter);
    res.json(result);
  })
);

/**
 * GET /api/research/scanner/results
 * Get paginated scanner-discovered tickers
 */
router.get(
  "/scanner/results",
  validate({ query: scannerResultsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const results = await marketScannerService.getResults(page, limit);
    res.json(results);
  })
);

/**
 * GET /api/research/scanner/scan-codes
 * Reference data: available scan codes with labels
 */
router.get(
  "/scanner/scan-codes",
  asyncHandler(async (_req, res) => {
    res.json([
      { code: "HOT_BY_OPT_VOLUME", label: "Hot by Option Volume", description: "Stocks with unusually high options trading volume" },
      { code: "HIGH_OPT_IMP_VOLAT", label: "High Option Implied Volatility", description: "Stocks with high implied volatility in options" },
      { code: "TOP_OPT_IMP_VOLAT_GAIN", label: "Top Option IV Gainers", description: "Stocks with the largest implied volatility increase" },
      { code: "HIGH_DIVIDEND_YIELD", label: "High Dividend Yield", description: "Stocks with the highest dividend yield" },
      { code: "MOST_ACTIVE", label: "Most Active", description: "Most actively traded stocks by volume" },
      { code: "TOP_PERC_GAIN", label: "Top % Gainers", description: "Stocks with the highest percentage price gain" },
      { code: "TOP_PERC_LOSE", label: "Top % Losers", description: "Stocks with the highest percentage price decline" },
      { code: "HIGH_VS_52W_HL", label: "Near 52-Week High", description: "Stocks trading near their 52-week high" },
      { code: "LOW_VS_52W_HL", label: "Near 52-Week Low", description: "Stocks trading near their 52-week low" },
      { code: "HOT_BY_VOLUME", label: "Hot by Volume", description: "Stocks with unusually high trading volume" },
      { code: "OPT_VOLUME_MOST_ACTIVE", label: "Most Active Options", description: "Stocks with the most active options contracts" },
      { code: "HIGH_OPT_OPEN_INTEREST_PUT_CALL_RATIO", label: "High Put/Call OI Ratio", description: "Stocks with high put-to-call open interest ratio" },
      { code: "LOW_OPT_IMP_VOLAT", label: "Low Option Implied Volatility", description: "Stocks with low implied volatility in options" },
      { code: "HIGH_PE_RATIO", label: "High P/E Ratio", description: "Stocks with the highest price-to-earnings ratio" },
      { code: "LOW_PE_RATIO", label: "Low P/E Ratio", description: "Stocks with the lowest price-to-earnings ratio" },
      { code: "HIGH_RETURN_ON_EQUITY", label: "High Return on Equity", description: "Stocks with the highest return on equity" },
      { code: "HIGH_GROWTH_RATE", label: "High Growth Rate", description: "Stocks with the highest earnings growth rate" },
    ]);
  })
);

// ══════════════════════════════════════════════════════════════════════
// DYNAMIC :symbol ROUTES (must come AFTER static routes)
// ══════════════════════════════════════════════════════════════════════

/**
 * GET /api/research/:symbol/data
 * Get raw collection data for a symbol (latest per source)
 */
router.get(
  "/:symbol/data",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();

    const ticker = await prisma.researchTicker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const collections: Array<{
      source: string;
      data: unknown;
      collectedAt: Date;
    }> = await prisma.$queryRaw`
      SELECT dc.source, dc.data, dc.collected_at AS "collectedAt"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY collected_at DESC) AS rn
        FROM data_collection
        WHERE ticker_id = ${ticker.id}::uuid AND status = 'ok'
      ) dc
      WHERE dc.rn = 1
    `;

    res.json({ symbol, collections });
  })
);

/**
 * GET /api/research/:symbol
 * Get the latest report for a symbol
 */
router.get(
  "/:symbol",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();

    const ticker = await prisma.researchTicker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const report = await prisma.researchReport.findFirst({
      where: { tickerId: ticker.id },
      orderBy: { createdAt: "desc" },
    });

    if (!report) throw new NotFoundError("Report", symbol);

    res.json({ ...report, symbol });
  })
);

/**
 * GET /api/research/:symbol/history
 * Paginated report history for a symbol
 */
router.get(
  "/:symbol/history",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 20)
    );

    const ticker = await prisma.researchTicker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const [reports, total] = await Promise.all([
      prisma.researchReport.findMany({
        where: { tickerId: ticker.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.researchReport.count({
        where: { tickerId: ticker.id },
      }),
    ]);

    res.json({ reports, total });
  })
);

/**
 * POST /api/research/:symbol/generate
 * Generate a new report for a symbol
 * Returns 202 with jobId
 */
router.post(
  "/:symbol/generate",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const options = req.body || {};

    const jobId = await pipelineService.generateReport(symbol, options);
    res.status(202).json({ jobId });
  })
);

/**
 * GET /api/research/:symbol/analysis
 * Get latest analysis per source + skipped collections
 */
router.get(
  "/:symbol/analysis",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();

    const ticker = await prisma.researchTicker.findUnique({
      where: { symbol },
    });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const analyses: Array<{
      id: string;
      tickerId: string;
      source: string;
      analyzedAt: Date;
      signal: string;
      confidence: number;
      summary: string;
      details: unknown;
    }> = await prisma.$queryRaw`
      SELECT a.id, a.ticker_id AS "tickerId", a.source,
             a.analyzed_at AS "analyzedAt", a.signal, a.confidence,
             a.summary, a.details
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY analyzed_at DESC) AS rn
        FROM analysis
        WHERE ticker_id = ${ticker.id}::uuid
      ) a
      WHERE a.rn = 1
    `;

    const skippedCollections: Array<{
      source: string;
      status: string;
      skipReason: string;
      collectedAt: Date;
    }> = await prisma.$queryRaw`
      SELECT dc.source, dc.status, dc.skip_reason AS "skipReason",
             dc.collected_at AS "collectedAt"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY collected_at DESC) AS rn
        FROM data_collection
        WHERE ticker_id = ${ticker.id}::uuid
      ) dc
      WHERE dc.rn = 1 AND dc.status = 'skipped'
    `;

    const collectionStatuses = skippedCollections;
    res.json({ symbol, analyses, collectionStatuses, lastUpdated: ticker.lastAnalyzed });
  })
);

/**
 * GET /api/research/:symbol/analysis/:source
 * Get latest analysis for a specific source
 */
router.get(
  "/:symbol/analysis/:source",
  asyncHandler(async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const { source } = req.params;
    const ticker = await prisma.researchTicker.findUnique({ where: { symbol } });
    if (!ticker) throw new NotFoundError("Ticker", symbol);

    const analysis = await prisma.analysis.findFirst({
      where: { tickerId: ticker.id, source },
      orderBy: { analyzedAt: "desc" },
    });
    if (!analysis) throw new NotFoundError("Analysis", `${symbol}/${source}`);
    res.json(analysis);
  })
);

export default router;
