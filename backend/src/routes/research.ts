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
import { screenerService } from "../services/research/screener.service.js";
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
import { fetchSAJson, closeBrowser as closeSABrowser } from "../services/research/collectors/sa-browser.js";
import {
  addTickersSchema,
  tickerParamsSchema,
  updateTickerSchema,
  tickerListQuerySchema,
} from "../services/research/schemas/ticker.schema.js";
import {
  createScreenerSchema,
  updateScreenerSchema,
  screenerIdParamsSchema,
  screenerResultsQuerySchema,
} from "../services/research/schemas/screener.schema.js";
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
    res.json(status);
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

// ── Screener ─────────────────────────────────────────────────────────

/**
 * GET /api/research/screener/configs
 * List all screener configs
 */
router.get(
  "/screener/configs",
  asyncHandler(async (_req, res) => {
    const configs = await screenerService.listConfigs();
    res.json(configs);
  })
);

/**
 * POST /api/research/screener/configs
 * Create a new screener config
 */
router.post(
  "/screener/configs",
  validate({ body: createScreenerSchema }),
  asyncHandler(async (req, res) => {
    const config = await screenerService.createConfig(req.body);
    await schedulerService.refreshScreenerSchedules();
    res.status(201).json(config);
  })
);

/**
 * GET /api/research/screener/configs/:id
 * Get a screener config by ID
 */
router.get(
  "/screener/configs/:id",
  validate({ params: screenerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const config = await screenerService.getConfig(req.params.id);
    res.json(config);
  })
);

/**
 * PATCH /api/research/screener/configs/:id
 * Update a screener config
 */
router.patch(
  "/screener/configs/:id",
  validate({ params: screenerIdParamsSchema, body: updateScreenerSchema }),
  asyncHandler(async (req, res) => {
    const config = await screenerService.updateConfig(req.params.id, req.body);
    await schedulerService.refreshScreenerSchedules();
    res.json(config);
  })
);

/**
 * DELETE /api/research/screener/configs/:id
 * Delete a screener config
 */
router.delete(
  "/screener/configs/:id",
  validate({ params: screenerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    await screenerService.deleteConfig(req.params.id);
    await schedulerService.refreshScreenerSchedules();
    res.status(204).end();
  })
);

/**
 * POST /api/research/screener/configs/:id/run
 * Run a screener config immediately
 */
router.post(
  "/screener/configs/:id/run",
  validate({ params: screenerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const configId = req.params.id;

    // Verify config exists
    const config = await screenerService.getConfig(configId);

    const job = await jobService.create("screener_run", config.name.slice(0, 20));

    // Run in background
    (async () => {
      try {
        await jobService.start(job.id);
        const result = await screenerService.runScreener(configId);
        await jobService.complete(job.id, result as unknown as Record<string, unknown>);
      } catch (err) {
        await jobService.fail(job.id, (err as Error).message);
      }
    })();

    res.status(202).json({ jobId: job.id });
  })
);

/**
 * GET /api/research/screener/results
 * Get recent screener-discovered tickers
 */
router.get(
  "/screener/results",
  validate({ query: screenerResultsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const results = await screenerService.getResults({ page, limit });
    res.json(results);
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
