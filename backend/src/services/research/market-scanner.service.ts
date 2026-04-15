import type { Prisma, MarketScannerPreset } from "@prisma/client";
import { SecType, BarSizeSetting, WhatToShow } from "@stoqey/ib";
import type { Bar } from "@stoqey/ib";
import { SMA, RSI } from "technicalindicators";
import { prisma } from "./db.js";
import { ibkrService } from "../ibkr.js";
import type { MarketScannerParams, ScannerResult } from "../ibkr.js";
import { NotFoundError } from "./errors/AppError.js";
import type {
  MarketScanResult,
  ScannerResultItem,
  TechnicalScore,
  TechnicalFilterConfig,
} from "@assup/shared";

// ── Helpers ──────────────────────────────────────────────────────────

function stockContract(symbol: string) {
  return {
    symbol,
    secType: SecType.STK,
    exchange: "SMART",
    currency: "USD",
  };
}

/**
 * Fetch daily bars for a symbol over the given number of years.
 * Returns an array of Bar objects with time in YYYYMMDD format.
 */
async function fetchDailyBars(
  symbol: string,
  years: number
): Promise<Bar[]> {
  return ibkrService.getHistoricalData({
    contract: stockContract(symbol),
    endDateTime: "",
    duration: `${years} Y`,
    barSizeSetting: BarSizeSetting.DAYS_ONE,
    whatToShow: WhatToShow.TRADES,
    useRth: 1,
    formatDate: 1,
  });
}

/**
 * Process items in batches of the given size, awaiting each batch.
 */
async function processBatched<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fn));
    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
  }
  return results;
}

// ── Service ──────────────────────────────────────────────────────────

class MarketScannerService {
  // ── Run Methods ──────────────────────────────────────────────────

  /**
   * Run a saved preset by ID.
   * 1. Load preset from DB
   * 2. Run TWS market scanner
   * 3. Apply technical filter (if configured)
   * 4. Add discovered tickers with source "scanner"
   * 5. Queue report generation for newly added tickers
   * 6. Update lastRun timestamp
   */
  async runPreset(presetId: string): Promise<MarketScanResult> {
    const preset = await prisma.marketScannerPreset.findUnique({
      where: { id: presetId },
    });
    if (!preset) throw new NotFoundError("MarketScannerPreset", presetId);

    const filters = preset.filters as Record<string, unknown>;
    const techConfig = preset.technicalFilter as unknown as TechnicalFilterConfig;

    const scanParams: MarketScannerParams = {
      scanCode: preset.scanCode,
      locationCode: preset.locationCode,
      numberOfRows: (filters.numberOfRows as number) ?? 50,
      abovePrice: filters.abovePrice as number | undefined,
      belowPrice: filters.belowPrice as number | undefined,
      aboveVolume: filters.aboveVolume as number | undefined,
      marketCapAbove: filters.marketCapAbove as number | undefined,
      marketCapBelow: filters.marketCapBelow as number | undefined,
      averageOptionVolumeAbove: filters.averageOptionVolumeAbove as number | undefined,
      stockTypeFilter: filters.stockTypeFilter as string | undefined,
    };

    const result = await this.executeAndProcess(scanParams, techConfig, preset.name);

    // Update lastRun
    await prisma.marketScannerPreset.update({
      where: { id: presetId },
      data: { lastRun: new Date() },
    });

    return result;
  }

  /**
   * Run an ad-hoc scan without saving a preset.
   * Does NOT create a watchlist — caller decides which symbols to keep.
   */
  async runAdhoc(
    params: MarketScannerParams,
    techConfig?: TechnicalFilterConfig
  ): Promise<MarketScanResult> {
    return this.executeAndProcess(params, techConfig, undefined, false);
  }

  /**
   * Shared execution logic for runPreset and runAdhoc.
   * @param createWatchlist If true, creates a watchlist with qualified symbols (default: true for presets)
   */
  private async executeAndProcess(
    params: MarketScannerParams,
    techConfig?: TechnicalFilterConfig,
    runName?: string,
    createWatchlist = true
  ): Promise<MarketScanResult> {
    console.log(
      `[MarketScanner] Running scan: scanCode=${params.scanCode}, location=${params.locationCode ?? "STK.US.MAJOR"}`
    );

    // Step 1: Run TWS scanner
    const scannerResults = await ibkrService.runMarketScanner(params);
    console.log(
      `[MarketScanner] TWS scanner returned ${scannerResults.length} candidates`
    );

    // Map raw scanner results to ScannerResultItem[]
    const discovered: ScannerResultItem[] = scannerResults.map((r) => ({
      rank: r.rank,
      symbol: r.symbol,
      conId: r.conId,
      exchange: r.exchange,
      secType: r.secType,
      longName: r.longName,
      industry: r.industry,
      category: r.category,
      subcategory: r.subcategory,
    }));

    const symbols = scannerResults.map((r) => r.symbol);

    // Step 2: Apply technical filter (if enabled)
    let scored: ScannerResultItem[] = discovered;
    let qualified: string[] = symbols;

    if (techConfig?.enabled) {
      const technicalScores = await this.applyTechnicalFilter(symbols, techConfig);
      const scoreMap = new Map(technicalScores.map((s) => [s.symbol, s]));

      // Attach technical scores to discovered items
      scored = discovered.map((item) => ({
        ...item,
        technical: scoreMap.get(item.symbol),
      }));

      qualified = technicalScores
        .filter((s) => s.passed)
        .map((s) => s.symbol);

      console.log(
        `[MarketScanner] Technical filter: ${qualified.length}/${symbols.length} passed`
      );
    }

    // Step 3: Optionally create watchlist with discovered tickers
    let watchlistId: string | null = null;
    let watchlistName: string | null = null;
    const addedSymbols: string[] = [];
    const skipped: string[] = [];

    if (createWatchlist) {
      const now = new Date();
      watchlistName = runName
        ? `${runName} - ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : `${params.scanCode} Scan - ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

      const watchlist = await prisma.watchlist.create({
        data: { name: watchlistName },
      });
      watchlistId = watchlist.id;

      for (const symbol of qualified) {
        try {
          await prisma.watchlistItem.create({
            data: {
              watchlistId: watchlist.id,
              symbol,
              source: "scanner",
            },
          });
          addedSymbols.push(symbol);
        } catch (err) {
          if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2002") {
            skipped.push(symbol);
          } else {
            throw err;
          }
        }
      }
      console.log(`[MarketScanner] Created watchlist "${watchlistName}" with ${addedSymbols.length} tickers, skipped ${skipped.length}`);
    }

    // Step 4: Persist scan run for history
    const scanRunName = runName || params.scanCode;
    await prisma.scanRun.create({
      data: {
        name: scanRunName,
        scanCode: params.scanCode,
        locationCode: params.locationCode ?? "STK.US.MAJOR",
        filters: params as unknown as Prisma.InputJsonValue,
        technicalFilter: (techConfig ?? {}) as unknown as Prisma.InputJsonValue,
        symbols: [...addedSymbols, ...skipped],
        watchlistId,
      },
    });

    return {
      discovered,
      scored,
      qualified,
      added: addedSymbols,
      skipped,
      watchlistId,
      watchlistName,
    };
  }

  // ── Technical Filter ─────────────────────────────────────────────

  /**
   * Batch-fetch 3-year daily bars and compute SMA200/SMA50/RSI14 for
   * each candidate, scoring and filtering based on the config.
   */
  async applyTechnicalFilter(
    candidates: string[],
    config: TechnicalFilterConfig
  ): Promise<TechnicalScore[]> {
    const BATCH_SIZE = 5;
    return processBatched(candidates, BATCH_SIZE, (symbol) =>
      this.scoreTechnical(symbol, config)
    );
  }

  /**
   * Score a single symbol against the technical filter criteria.
   * Returns a TechnicalScore with pass/fail and 0-100 score.
   */
  async scoreTechnical(
    symbol: string,
    config: TechnicalFilterConfig
  ): Promise<TechnicalScore> {
    const years = config.trendPeriodYears ?? 3;
    const maxRsi = config.maxRsi ?? 40;
    const requireAboveSma200 = config.requireAboveSma200 ?? true;
    const require50Above200 = config.require50Above200 ?? false;
    const minSma200SlopeMonths = config.minSma200SlopeMonths ?? 6;

    const emptyScore: TechnicalScore = {
      symbol,
      passed: false,
      score: 0,
      details: {
        aboveSma200: false,
        sma200SlopePositive: false,
        sma50Above200: false,
        rsi14: null,
        currentPrice: null,
        sma200: null,
        sma50: null,
      },
    };

    let bars: Bar[];
    try {
      bars = await fetchDailyBars(symbol, years);
    } catch (err) {
      console.warn(
        `[MarketScanner] Failed to fetch bars for ${symbol}: ${(err as Error).message}`
      );
      return emptyScore;
    }

    if (bars.length < 200) {
      console.warn(
        `[MarketScanner] Insufficient bars for ${symbol}: ${bars.length} (need >= 200)`
      );
      return emptyScore;
    }

    const closes = bars.map((b) => b.close ?? 0).filter((c) => c > 0);
    if (closes.length < 200) {
      return emptyScore;
    }

    const currentPrice = closes[closes.length - 1];

    // SMA 200
    const sma200Values = SMA.calculate({ values: closes, period: 200 });
    const sma200 =
      sma200Values.length > 0 ? sma200Values[sma200Values.length - 1] : null;

    // SMA 50
    const sma50Values = SMA.calculate({ values: closes, period: 50 });
    const sma50 =
      sma50Values.length > 0 ? sma50Values[sma50Values.length - 1] : null;

    // RSI 14
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const rsi14 =
      rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    // SMA200 slope: positive if current SMA200 > SMA200 N months ago
    const tradingDaysPerMonth = 21;
    const slopeOffset = minSma200SlopeMonths * tradingDaysPerMonth;
    let sma200SlopePositive = false;
    if (sma200Values.length > slopeOffset) {
      const oldSma200 = sma200Values[sma200Values.length - 1 - slopeOffset];
      sma200SlopePositive = sma200 != null && sma200 > oldSma200;
    }

    // Conditions
    const aboveSma200 = sma200 != null && currentPrice > sma200;
    const sma50Above200 = sma50 != null && sma200 != null && sma50 > sma200;

    // Scoring: 0-100
    let score = 0;

    // Above SMA200: up to 25 points
    if (aboveSma200) score += 25;

    // SMA200 slope positive: up to 25 points
    if (sma200SlopePositive) score += 25;

    // SMA50 > SMA200 (golden cross): up to 20 points
    if (sma50Above200) score += 20;

    // RSI bonus: 0-30 points (lower RSI = more upside opportunity)
    if (rsi14 != null) {
      if (rsi14 <= 30) score += 30;
      else if (rsi14 <= 40) score += 20;
      else if (rsi14 <= 50) score += 10;
      // Higher RSI = no bonus
    }

    // Pass/fail checks
    let passed = true;
    if (requireAboveSma200 && !aboveSma200) passed = false;
    if (require50Above200 && !sma50Above200) passed = false;
    if (rsi14 != null && rsi14 > maxRsi) passed = false;

    return {
      symbol,
      passed,
      score,
      details: {
        aboveSma200,
        sma200SlopePositive,
        sma50Above200,
        rsi14,
        currentPrice,
        sma200,
        sma50,
      },
    };
  }

  // ── CRUD ─────────────────────────────────────────────────────────

  async createPreset(data: {
    name: string;
    scanCode: string;
    locationCode?: string;
    filters?: Record<string, unknown>;
    technicalFilter?: TechnicalFilterConfig;
    schedule?: string;
    enabled?: boolean;
  }): Promise<MarketScannerPreset> {
    return prisma.marketScannerPreset.create({
      data: {
        name: data.name,
        scanCode: data.scanCode,
        locationCode: data.locationCode ?? "STK.US.MAJOR",
        filters: (data.filters ?? {}) as Prisma.InputJsonValue,
        technicalFilter: (data.technicalFilter ?? {}) as unknown as Prisma.InputJsonValue,
        schedule: data.schedule ?? "",
        enabled: data.enabled ?? true,
      },
    });
  }

  async getPreset(id: string): Promise<MarketScannerPreset> {
    const preset = await prisma.marketScannerPreset.findUnique({
      where: { id },
    });
    if (!preset) throw new NotFoundError("MarketScannerPreset", id);
    return preset;
  }

  async listPresets(): Promise<MarketScannerPreset[]> {
    return prisma.marketScannerPreset.findMany({
      orderBy: { name: "asc" },
    });
  }

  async updatePreset(
    id: string,
    data: Partial<{
      name: string;
      scanCode: string;
      locationCode: string;
      filters: Record<string, unknown>;
      technicalFilter: TechnicalFilterConfig;
      schedule: string;
      enabled: boolean;
    }>
  ): Promise<MarketScannerPreset> {
    const existing = await prisma.marketScannerPreset.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundError("MarketScannerPreset", id);

    return prisma.marketScannerPreset.update({
      where: { id },
      data: {
        ...data,
        filters: data.filters
          ? (data.filters as Prisma.InputJsonValue)
          : undefined,
        technicalFilter: data.technicalFilter
          ? (data.technicalFilter as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async deletePreset(id: string): Promise<void> {
    const existing = await prisma.marketScannerPreset.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundError("MarketScannerPreset", id);

    await prisma.marketScannerPreset.delete({ where: { id } });
  }

  // ── Results ──────────────────────────────────────────────────────

  /**
   * Get tickers discovered by the scanner (source='scanner'),
   * sorted by addedAt desc with pagination.
   */
  async getResults(page: number, limit: number) {
    const where = { source: "scanner" };
    const [items, total] = await Promise.all([
      prisma.watchlistItem.findMany({
        where,
        orderBy: { addedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: { symbol: true, addedAt: true, watchlistId: true },
      }),
      prisma.watchlistItem.count({ where }),
    ]);
    return { tickers: items, total };
  }

  // ── Scan Runs ─────────────────────────────────────────────────

  async listScanRuns() {
    return prisma.scanRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async deleteScanRun(id: string) {
    await prisma.scanRun.delete({ where: { id } });
  }
}

export const marketScannerService = new MarketScannerService();
