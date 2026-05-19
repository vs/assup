// backend/src/services/wheelStrategy.service.ts
import { prisma } from "../db/index.js";
import { sseService } from "./sse.js";
import { getUnderinvestedClasses } from "./allocation.service.js";
import { getMarketDataProvider } from "./research/providers/index.js";
import { pipelineService } from "./research/pipeline.service.js";
import type {
  WheelStrategy,
  WheelStrategyInput,
  WheelStrategyScan,
  CspResultItem,
  CcResultItem,
  SkippedTicker,
  WheelStrategyProgress,
} from "@assup/shared";

const MAX_SCAN_HISTORY = 50;

class WheelStrategyService {
  // === CRUD ===

  async list(): Promise<WheelStrategy[]> {
    const strategies = await prisma.wheelStrategy.findMany({
      orderBy: { createdAt: "desc" },
    });
    return strategies as unknown as WheelStrategy[];
  }

  async get(id: string): Promise<(WheelStrategy & { latestScan: WheelStrategyScan | null }) | null> {
    const strategy = await prisma.wheelStrategy.findUnique({
      where: { id },
      include: {
        scans: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!strategy) return null;
    const { scans, ...rest } = strategy;
    return {
      ...(rest as unknown as WheelStrategy),
      latestScan: (scans[0] as unknown as WheelStrategyScan) ?? null,
    };
  }

  async create(input: WheelStrategyInput): Promise<WheelStrategy> {
    const strategy = await prisma.wheelStrategy.create({
      data: {
        name: input.name,
        enabled: input.enabled ?? true,
        minMarketCap: input.minMarketCap ?? 5_000_000_000,
        cspMinDte: input.cspMinDte ?? 25,
        cspMaxDte: input.cspMaxDte ?? 35,
        cspMaxDelta: input.cspMaxDelta ?? -0.34,
        cspMinRoi: input.cspMinRoi ?? 2.5,
        cspMaxRoi: input.cspMaxRoi ?? 3.5,
        ccMinDte: input.ccMinDte ?? 5,
        ccMaxDte: input.ccMaxDte ?? 10,
        ccMinRoi: input.ccMinRoi ?? null,
        maxPositions: input.maxPositions ?? 10,
        maxPerAssetClass: input.maxPerAssetClass ?? 2,
        targetAssetClasses: input.targetAssetClasses ?? [],
        acceptedRecommendations: input.acceptedRecommendations ?? ["buy", "wheel"],
        minResearchConfidence: input.minResearchConfidence ?? null,
        requireFreshReport: input.requireFreshReport ?? true,
        reportMaxAgeDays: input.reportMaxAgeDays ?? 7,
        intervalHours: input.intervalHours ?? null,
        cronExpression: input.cronExpression ?? null,
      },
    });
    return strategy as unknown as WheelStrategy;
  }

  async update(id: string, input: Partial<WheelStrategyInput>): Promise<WheelStrategy> {
    const strategy = await prisma.wheelStrategy.update({
      where: { id },
      data: input,
    });
    return strategy as unknown as WheelStrategy;
  }

  async delete(id: string): Promise<void> {
    await prisma.wheelStrategy.delete({ where: { id } });
  }

  // === Scan Management ===

  async startScan(strategyId: string): Promise<string> {
    // Guard: check no running scan
    const running = await prisma.wheelStrategyScan.findFirst({
      where: { strategyId, status: "running" },
    });
    if (running) {
      throw new Error("A scan is already running for this strategy");
    }

    const scan = await prisma.wheelStrategyScan.create({
      data: {
        strategyId,
        status: "pending",
      },
    });

    // Launch async pipeline
    this.runPipeline(scan.id, strategyId).catch((err) => {
      console.error("[WheelStrategy] Pipeline error:", err);
    });

    return scan.id;
  }

  async getScans(strategyId: string, limit = 10): Promise<WheelStrategyScan[]> {
    const scans = await prisma.wheelStrategyScan.findMany({
      where: { strategyId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return scans as unknown as WheelStrategyScan[];
  }

  async getScan(scanId: string): Promise<WheelStrategyScan | null> {
    const scan = await prisma.wheelStrategyScan.findUnique({
      where: { id: scanId },
    });
    return scan as unknown as WheelStrategyScan | null;
  }

  // === Pipeline ===

  private async runPipeline(scanId: string, strategyId: string): Promise<void> {
    const strategy = await prisma.wheelStrategy.findUnique({ where: { id: strategyId } });
    if (!strategy) throw new Error(`Strategy ${strategyId} not found`);

    await prisma.wheelStrategyScan.update({
      where: { id: scanId },
      data: { status: "running", startedAt: new Date() },
    });

    const skippedTickers: SkippedTicker[] = [];

    try {
      // Phase 1: Discovery
      const discovered = await this.phaseDiscovery(scanId, strategy);

      // Phase 2: Fundamentals
      const fundamentallySound = await this.phaseFundamentals(scanId, strategy, discovered, skippedTickers);

      // Phase 3: Earnings
      const earningsSafe = await this.phaseEarnings(scanId, strategy, fundamentallySound, skippedTickers);

      // Phase 4: Contract scanning
      const withContracts = await this.phaseContracts(scanId, strategy, earningsSafe, skippedTickers);

      // Phase 5: Ranking & diversification
      const cspResults = this.phaseRanking(strategy, withContracts);

      // Phase 5b: CC scanning
      const ccResults = await this.phaseCcScanning(scanId, strategy);

      // Phase 6: Finalize
      await this.phaseFinalize(scanId, strategyId, cspResults, ccResults, skippedTickers);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[WheelStrategy] Pipeline failed:", message);
      await prisma.wheelStrategyScan.update({
        where: { id: scanId },
        data: { status: "failed", errorMessage: message, completedAt: new Date() },
      });
    }

    // Prune old scans
    await this.pruneScans(strategyId);
  }

  // Stub methods — implemented in subsequent tasks
  private async phaseDiscovery(scanId: string, strategy: any): Promise<DiscoveredTicker[]> {
    this.emitProgress(scanId, "discovery", 0, 1);

    // 1. Get underinvested asset classes
    const underinvested = await getUnderinvestedClasses();
    if (underinvested.length === 0) {
      console.log("[WheelStrategy] No underinvested asset classes found");
      return [];
    }

    // 2. Filter to target classes if specified
    const targetClasses = strategy.targetAssetClasses.length > 0
      ? underinvested.filter((c: any) => strategy.targetAssetClasses.includes(c.id))
      : underinvested;

    if (targetClasses.length === 0) return [];

    // 3. Get existing wheel tracker symbols to exclude
    const trackedSymbols = (await prisma.wheelTracker.findMany({ select: { symbol: true } }))
      .map((t: { symbol: string }) => t.symbol);

    // 4. Get WheelScanConfigs for seed tickers and keywords
    const configs = await prisma.wheelScanConfig.findMany({
      where: { assetClassId: { in: targetClasses.map((c: any) => c.id) }, enabled: true },
    });
    const configByClass = new Map(configs.map((c: any) => [c.assetClassId, c]));

    const provider = getMarketDataProvider();
    const discovered: DiscoveredTicker[] = [];
    const seenSymbols = new Set(trackedSymbols);
    const CAP_PER_CLASS = 30;

    for (let i = 0; i < targetClasses.length; i++) {
      const cls = targetClasses[i];
      const config = configByClass.get(cls.id);
      let classTickers: DiscoveredTicker[] = [];

      // Note: cls.difference is negative (currentPct - targetPct), Math.abs gives positive shortfall
      const allocationNeed = Math.abs(cls.difference);

      if (config?.seedTickers) {
        for (const symbol of config.seedTickers) {
          if (!seenSymbols.has(symbol)) {
            seenSymbols.add(symbol);
            classTickers.push({
              symbol,
              assetClassId: cls.id,
              assetClassName: cls.name,
              marketCap: 0,
              lastPrice: 0,
              allocationNeed,
            });
          }
        }
      }

      // Search via Polygon keywords
      if (config?.searchKeywords) {
        for (const keyword of config.searchKeywords) {
          try {
            const results = await provider.searchTickers({
              search: keyword,
              market: "stocks",
              active: true,
            });
            for (const r of results.slice(0, 50)) {
              if (!seenSymbols.has(r.symbol) && (r.marketCap ?? 0) >= strategy.minMarketCap) {
                seenSymbols.add(r.symbol);
                classTickers.push({
                  symbol: r.symbol,
                  assetClassId: cls.id,
                  assetClassName: cls.name,
                  marketCap: r.marketCap ?? 0,
                  lastPrice: r.lastPrice ?? 0,
                  allocationNeed,
                });
              }
            }
          } catch (err) {
            console.error(`[WheelStrategy] Keyword search "${keyword}" failed:`, err);
          }
        }
      }

      classTickers = classTickers.slice(0, CAP_PER_CLASS);
      discovered.push(...classTickers);

      this.emitProgress(scanId, "discovery", i + 1, targetClasses.length);
    }

    await prisma.wheelStrategyScan.update({
      where: { id: scanId },
      data: { totalCandidates: discovered.length },
    });

    console.log(`[WheelStrategy] Discovered ${discovered.length} candidates across ${targetClasses.length} classes`);
    return discovered;
  }

  private async phaseFundamentals(
    scanId: string,
    strategy: any,
    tickers: DiscoveredTicker[],
    skipped: SkippedTicker[],
  ): Promise<FundamentalTicker[]> {
    if (tickers.length === 0) return [];
    this.emitProgress(scanId, "fundamentals", 0, tickers.length);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - strategy.reportMaxAgeDays);

    const accepted: FundamentalTicker[] = [];

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];

      // Find most recent research report
      const report = await prisma.researchReport.findFirst({
        where: { symbol: ticker.symbol },
        orderBy: { createdAt: "desc" },
      });

      if (!report) {
        if (strategy.requireFreshReport) {
          skipped.push({ symbol: ticker.symbol, reason: "No research report available" });
          // Trigger background report generation for next cycle
          pipelineService.generateReport(ticker.symbol).catch((err: unknown) => {
            console.error(`[WheelStrategy] Background report generation failed for ${ticker.symbol}:`, err);
          });
        }
        this.emitProgress(scanId, "fundamentals", i + 1, tickers.length);
        continue;
      }

      // Check freshness
      if (strategy.requireFreshReport && report.createdAt < cutoffDate) {
        skipped.push({ symbol: ticker.symbol, reason: `Report too old (${report.createdAt.toISOString().split("T")[0]})` });
        // Trigger refresh
        pipelineService.generateReport(ticker.symbol).catch(() => {});
        this.emitProgress(scanId, "fundamentals", i + 1, tickers.length);
        continue;
      }

      // Check recommendation
      if (!strategy.acceptedRecommendations.includes(report.recommendation)) {
        skipped.push({ symbol: ticker.symbol, reason: `Recommendation: ${report.recommendation}` });
        this.emitProgress(scanId, "fundamentals", i + 1, tickers.length);
        continue;
      }

      // Check confidence
      if (strategy.minResearchConfidence != null && report.confidence < strategy.minResearchConfidence) {
        skipped.push({ symbol: ticker.symbol, reason: `Low confidence: ${report.confidence}` });
        this.emitProgress(scanId, "fundamentals", i + 1, tickers.length);
        continue;
      }

      accepted.push({
        ...ticker,
        researchRecommendation: report.recommendation,
        researchConfidence: report.confidence,
      });

      this.emitProgress(scanId, "fundamentals", i + 1, tickers.length);
    }

    console.log(`[WheelStrategy] Fundamentals: ${accepted.length}/${tickers.length} passed`);
    return accepted;
  }

  private async phaseEarnings(
    scanId: string,
    strategy: any,
    tickers: FundamentalTicker[],
    skipped: SkippedTicker[],
  ): Promise<EarningsSafeTicker[]> {
    if (tickers.length === 0) return [];
    this.emitProgress(scanId, "earnings", 0, tickers.length);

    const maxExpiration = new Date();
    maxExpiration.setDate(maxExpiration.getDate() + strategy.cspMaxDte);

    const provider = getMarketDataProvider();
    const accepted: EarningsSafeTicker[] = [];

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];
      let earningsDate: string | null = null;

      try {
        const events = await provider.getEarningsCalendar(ticker.symbol);
        // Find next upcoming earnings
        const now = new Date();
        const upcoming = events
          .filter((e) => new Date(e.date) > now)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        if (upcoming.length > 0) {
          earningsDate = upcoming[0].date;
          const earningsDateObj = new Date(earningsDate);

          if (earningsDateObj <= maxExpiration) {
            skipped.push({
              symbol: ticker.symbol,
              reason: `Earnings on ${earningsDate} before max expiry ${maxExpiration.toISOString().split("T")[0]}`,
            });
            this.emitProgress(scanId, "earnings", i + 1, tickers.length);
            continue;
          }
        }
      } catch (err) {
        // If earnings data unavailable, allow the ticker through (conservative)
        console.warn(`[WheelStrategy] Earnings check failed for ${ticker.symbol}:`, err);
      }

      accepted.push({ ...ticker, earningsDate });
      this.emitProgress(scanId, "earnings", i + 1, tickers.length);
    }

    console.log(`[WheelStrategy] Earnings: ${accepted.length}/${tickers.length} passed`);
    return accepted;
  }

  private async phaseContracts(_scanId: string, _strategy: any, _tickers: EarningsSafeTicker[], _skipped: SkippedTicker[]): Promise<ContractTicker[]> {
    return [];
  }

  private phaseRanking(_strategy: any, _tickers: ContractTicker[]): CspResultItem[] {
    return [];
  }

  private async phaseCcScanning(_scanId: string, _strategy: any): Promise<CcResultItem[]> {
    return [];
  }

  private async phaseFinalize(
    scanId: string,
    strategyId: string,
    cspResults: CspResultItem[],
    ccResults: CcResultItem[],
    skippedTickers: SkippedTicker[],
  ): Promise<void> {
    await prisma.wheelStrategyScan.update({
      where: { id: scanId },
      data: {
        status: "completed",
        cspResults: cspResults as any,
        ccResults: ccResults as any,
        skippedTickers: skippedTickers as any,
        // Note: totalCandidates is set in phaseDiscovery — don't overwrite it here
        processedCandidates: cspResults.length + ccResults.length,
        completedAt: new Date(),
      },
    });

    await prisma.wheelStrategy.update({
      where: { id: strategyId },
      data: { lastRunAt: new Date() },
    });

    this.emitProgress(scanId, "completed", 0, 0, cspResults.length, ccResults.length);
  }

  private async pruneScans(strategyId: string): Promise<void> {
    const scans = await prisma.wheelStrategyScan.findMany({
      where: { strategyId },
      orderBy: { createdAt: "desc" },
      skip: MAX_SCAN_HISTORY,
      select: { id: true },
    });
    if (scans.length > 0) {
      await prisma.wheelStrategyScan.deleteMany({
        where: { id: { in: scans.map((s: { id: string }) => s.id) } },
      });
    }
  }

  private emitProgress(
    scanId: string,
    phase: WheelStrategyProgress["phase"],
    current: number,
    total: number,
    cspCount?: number,
    ccCount?: number,
  ): void {
    const data: WheelStrategyProgress = { scanId, phase, current, total };
    if (cspCount !== undefined) data.cspCount = cspCount;
    if (ccCount !== undefined) data.ccCount = ccCount;
    sseService.broadcast("wheel_strategy", data);
  }
}

// === Internal pipeline types ===

export interface DiscoveredTicker {
  symbol: string;
  assetClassId: string;
  assetClassName: string;
  marketCap: number;
  lastPrice: number;
  allocationNeed: number;
}

export interface FundamentalTicker extends DiscoveredTicker {
  researchRecommendation: string;
  researchConfidence: number;
}

export interface EarningsSafeTicker extends FundamentalTicker {
  earningsDate: string | null;
}

export interface ContractTicker extends EarningsSafeTicker {
  contract: {
    strike: number;
    expiration: string;
    daysToExpiry: number;
    delta: number | null;
    bid: number;
    ask: number;
    midPrice: number;
    premiumPercent: number;
    annualizedReturn: number;
  };
}

export const wheelStrategyService = new WheelStrategyService();
