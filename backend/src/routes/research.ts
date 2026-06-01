/**
 * Research API routes
 * Direct service calls (replaces HTTP proxy to research microservice)
 */

import { Router } from "express";
import { execFile, spawn } from "node:child_process";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { prisma } from "../db/index.js";

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
  getSAApiKeyStatus,
  setSAApiKey,
  deleteSAApiKey,
  fetchSAMetrics,
} from "../services/research/collectors/sa-rapidapi.js";

import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../errors/AppError.js";

const router = Router();

// ── Claude status cache (avoid spawning CLI on every page load) ─────

let claudeStatusCache: { result: unknown; expiresAt: number } | null = null;
const CLAUDE_STATUS_TTL = 5 * 60 * 1000; // 5 minutes

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

// ── Jobs ─────────────────────────────────────────────────────────────

/**
 * GET /api/research/jobs
 * List jobs with optional status filter
 */
router.get(
  "/jobs",
  asyncHandler(async (req, res) => {
    const rawStatus = req.query.status;
    const status = Array.isArray(rawStatus)
      ? (rawStatus as string[])
      : typeof rawStatus === "string"
        ? rawStatus
        : undefined;
    const type = req.query.type as string | undefined;
    const rawLimit = parseInt(req.query.limit as string, 10) || 50;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const jobs = await jobService.list({ status, type, limit });
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
    // Return cached result if fresh (CLI spawn + test prompt is slow)
    if (claudeStatusCache && Date.now() < claudeStatusCache.expiresAt) {
      res.json(claudeStatusCache.result);
      return;
    }

    // Check if claude CLI is installed
    const versionResult = await new Promise<{
      ok: boolean;
      version?: string;
      error?: string;
    }>((resolve) => {
      execFile("claude", ["--version"], { timeout: 10_000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: err.message });
        } else {
          resolve({ ok: true, version: stdout.trim() || stderr.trim() });
        }
      });
    });

    if (!versionResult.ok) {
      const result = {
        available: false,
        mode: "none",
        error: `Claude CLI not found: ${versionResult.error}`,
      };
      claudeStatusCache = { result, expiresAt: Date.now() + CLAUDE_STATUS_TTL };
      res.json(result);
      return;
    }

    // Test with a simple prompt using stored token if available
    const storedToken = await getOAuthToken();
    const testResult = await testCli("Reply with exactly: ok", storedToken ?? undefined);
    if (!testResult.ok) {
      const result = {
        available: false,
        mode: "cli",
        error: `Claude CLI not authenticated: ${testResult.error}`,
      };
      claudeStatusCache = { result, expiresAt: Date.now() + CLAUDE_STATUS_TTL };
      res.json(result);
      return;
    }

    const result = { available: true, mode: "cli" };
    claudeStatusCache = { result, expiresAt: Date.now() + CLAUDE_STATUS_TTL };
    res.json(result);
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
    claudeStatusCache = null; // Invalidate cache after token change
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
    claudeStatusCache = null; // Invalidate cache after token removal
    const status = await getAuthStatus();
    res.json(status);
  })
);

// ── Seeking Alpha Auth ───────────────────────────────────────────────

router.get(
  "/sa-auth/status",
  asyncHandler(async (_req, res) => {
    const status = await getSAApiKeyStatus();
    res.json(status);
  })
);

router.put(
  "/sa-auth/credentials",
  asyncHandler(async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== "string") {
      res.status(400).json({ error: "API key is required" });
      return;
    }
    await setSAApiKey(apiKey.trim());
    const status = await getSAApiKeyStatus();
    res.json(status);
  })
);

router.delete(
  "/sa-auth/credentials",
  asyncHandler(async (_req, res) => {
    await deleteSAApiKey();
    const status = await getSAApiKeyStatus();
    res.json(status);
  })
);

router.post(
  "/sa-auth/test",
  asyncHandler(async (_req, res) => {
    const metrics = await fetchSAMetrics("AAPL", ["pe_nongaap_fy1"]);
    res.json({
      ok: metrics != null,
      hasData: metrics != null && Object.keys(metrics).length > 0,
    });
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
  schedule: z.string().max(50).optional().default(""),
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
 * GET /api/research/scanner/runs
 * List scan run history
 */
router.get(
  "/scanner/runs",
  asyncHandler(async (_req, res) => {
    const runs = await marketScannerService.listScanRuns();
    res.json(runs);
  })
);

/**
 * DELETE /api/research/scanner/runs/:id
 * Delete a scan run
 */
router.delete(
  "/scanner/runs/:id",
  asyncHandler(async (req, res) => {
    await marketScannerService.deleteScanRun(req.params.id);
    res.status(204).send();
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
    const collections = await prisma.$queryRaw`
      SELECT dc.source, dc.data, dc.collected_at AS "collectedAt"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY collected_at DESC) AS rn
        FROM data_collection
        WHERE symbol = ${symbol} AND status = 'ok'
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
    const report = await prisma.researchReport.findFirst({
      where: { symbol },
      orderBy: { createdAt: "desc" },
    });
    if (!report) throw new NotFoundError("Report", symbol);
    res.json(report);
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
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const [reports, total] = await Promise.all([
      prisma.researchReport.findMany({
        where: { symbol },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.researchReport.count({ where: { symbol } }),
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

    const analyses = await prisma.$queryRaw`
      SELECT a.id, a.symbol, a.source,
             a.analyzed_at AS "analyzedAt", a.signal, a.confidence,
             a.summary, a.details
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY analyzed_at DESC) AS rn
        FROM analysis
        WHERE symbol = ${symbol}
      ) a
      WHERE a.rn = 1
    `;

    const skippedCollections = await prisma.$queryRaw`
      SELECT dc.source, dc.status, dc.skip_reason AS "skipReason",
             dc.collected_at AS "collectedAt"
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY source ORDER BY collected_at DESC) AS rn
        FROM data_collection
        WHERE symbol = ${symbol}
      ) dc
      WHERE dc.rn = 1 AND dc.status = 'skipped'
    `;

    const item = await prisma.watchlistItem.findFirst({
      where: { symbol },
      select: { lastAnalyzedAt: true },
      orderBy: { lastAnalyzedAt: "desc" },
    });

    res.json({ symbol, analyses, collectionStatuses: skippedCollections, lastUpdated: item?.lastAnalyzedAt });
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
    const analysis = await prisma.analysis.findFirst({
      where: { symbol, source },
      orderBy: { analyzedAt: "desc" },
    });
    if (!analysis) throw new NotFoundError("Analysis", `${symbol}/${source}`);
    res.json(analysis);
  })
);

export default router;
