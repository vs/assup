// backend/src/services/wheelStrategy.service.ts
import { prisma } from "../db/index.js";
import { sseService } from "./sse.js";
import { getUnderinvestedClasses } from "./allocation.service.js";
import { getMarketDataProvider } from "./research/providers/index.js";
import { pipelineService } from "./research/pipeline.service.js";
import { ibkrService } from "./ibkr.js";
import { wheelService } from "./wheel.service.js";
import {
  withLiveMarketData,
  getUnderlyingPrice,
  filterChainByStrike,
  calcOptionMetrics,
} from "../utils/options.js";
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

  private async phaseContracts(
    scanId: string,
    strategy: any,
    tickers: EarningsSafeTicker[],
    skipped: SkippedTicker[],
  ): Promise<ContractTicker[]> {
    if (tickers.length === 0) return [];
    this.emitProgress(scanId, "contracts", 0, tickers.length);

    const accepted: ContractTicker[] = [];
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 2000;

    await withLiveMarketData(async () => {
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map((ticker) => this.scanTickerContracts(ticker, strategy)),
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const ticker = batch[j];

          if (result.status === "fulfilled" && result.value) {
            accepted.push(result.value);
          } else if (result.status === "rejected") {
            skipped.push({
              symbol: ticker.symbol,
              reason: `Contract scan failed: ${result.reason}`,
            });
          } else {
            // Fulfilled but no matching contract
            skipped.push({
              symbol: ticker.symbol,
              reason: "No contracts matching criteria",
            });
          }

          this.emitProgress(scanId, "contracts", i + j + 1, tickers.length);
        }

        // Rate limiting delay between batches
        if (i + BATCH_SIZE < tickers.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
    });

    console.log(`[WheelStrategy] Contracts: ${accepted.length}/${tickers.length} have matching contracts`);
    return accepted;
  }

  private async scanTickerContracts(
    ticker: EarningsSafeTicker,
    strategy: any,
  ): Promise<ContractTicker | null> {
    const underlyingPrice = await getUnderlyingPrice(ticker.symbol);
    if (!underlyingPrice) return null;

    const chain = await ibkrService.getOptionChain(ticker.symbol);
    if (!chain || chain.length === 0) return null;

    // Filter by strike range (near money, 80-105% of price for puts)
    const filtered = filterChainByStrike(chain, underlyingPrice, 80, 105);

    const getDte = (exp: string): number => {
      const expDate = new Date(
        exp.substring(0, 4) + "-" + exp.substring(4, 6) + "-" + exp.substring(6, 8),
      );
      return Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    };

    // Filter by DTE
    const dteFiltered = filtered.filter((entry) => {
      const dte = getDte(entry.expiration);
      return dte >= strategy.cspMinDte && dte <= strategy.cspMaxDte;
    });

    if (dteFiltered.length === 0) return null;

    // Get put contracts for market data
    const putContracts = dteFiltered.map((entry) => ({ entry, contract: entry.put }));

    if (putContracts.length === 0) return null;

    // Fetch market data in batch
    const marketData = await ibkrService.getMarketDataBatch(
      putContracts.map((p) => p.contract),
    );

    // Evaluate each contract
    let bestContract: ContractTicker["contract"] | null = null;
    let bestRoi = 0;

    for (const { entry } of putContracts) {
      const key = `${ticker.symbol}_${entry.expiration}_${entry.strike}_PUT`;
      const data = marketData.get(key);
      if (!data) continue;

      const bid = data.bid ?? 0;
      const ask = data.ask ?? 0;
      if (bid <= 0) continue;

      const dte = getDte(entry.expiration);
      const metrics = calcOptionMetrics(bid, ask, entry.strike, dte);

      // Delta filter (stored as negative in strategy, data is negative for puts)
      const delta = data.delta ?? null;
      if (delta != null) {
        if (Math.abs(delta) > Math.abs(strategy.cspMaxDelta)) continue;
      }

      // ROI filter
      if (metrics.premiumPercent < strategy.cspMinRoi || metrics.premiumPercent > strategy.cspMaxRoi) {
        continue;
      }

      // Track best by ROI
      if (metrics.premiumPercent > bestRoi) {
        bestRoi = metrics.premiumPercent;
        const expFormatted = `${entry.expiration.substring(0, 4)}-${entry.expiration.substring(4, 6)}-${entry.expiration.substring(6, 8)}`;
        bestContract = {
          strike: entry.strike,
          expiration: expFormatted,
          daysToExpiry: dte,
          delta,
          bid,
          ask,
          midPrice: metrics.midPrice,
          premiumPercent: metrics.premiumPercent,
          annualizedReturn: metrics.annualizedReturn,
        };
      }
    }

    if (!bestContract) return null;

    return {
      ...ticker,
      lastPrice: underlyingPrice,
      contract: bestContract,
    };
  }

  private phaseRanking(strategy: any, tickers: ContractTicker[]): CspResultItem[] {
    if (tickers.length === 0) return [];

    // Score each candidate
    const scored = tickers.map((t) => {
      // ROI score (50%): normalize premiumPercent to 0-100 scale (0-5% range)
      const roiScore = Math.min(100, (t.contract.premiumPercent / 5) * 100);

      // Research confidence score (25%): confidence is already 0-1
      const confidenceScore = t.researchConfidence * 100;

      // Allocation need score (25%): 0-10% shortfall maps to 0-100
      const allocationScore = Math.min(100, (t.allocationNeed / 10) * 100);

      const compositeScore = roiScore * 0.5 + confidenceScore * 0.25 + allocationScore * 0.25;

      return { ...t, compositeScore };
    });

    // Sort by composite score descending
    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Apply diversification constraints
    const selected: CspResultItem[] = [];
    const classCount = new Map<string, number>();

    for (const t of scored) {
      if (selected.length >= strategy.maxPositions) break;

      const currentClassCount = classCount.get(t.assetClassId) ?? 0;
      if (currentClassCount >= strategy.maxPerAssetClass) continue;

      classCount.set(t.assetClassId, currentClassCount + 1);
      selected.push({
        symbol: t.symbol,
        assetClassId: t.assetClassId,
        assetClassName: t.assetClassName,
        researchRecommendation: t.researchRecommendation as any,
        researchConfidence: t.researchConfidence,
        earningsDate: t.earningsDate,
        contract: t.contract,
        compositeScore: t.compositeScore,
        allocationNeed: t.allocationNeed,
        marketCap: t.marketCap,
        lastPrice: t.lastPrice,
      });
    }

    console.log(`[WheelStrategy] Ranking: selected ${selected.length} from ${tickers.length} candidates`);
    return selected;
  }

  private async phaseCcScanning(scanId: string, strategy: any): Promise<CcResultItem[]> {
    // Get wheel tracker tickers with live data
    let summaries;
    try {
      summaries = await wheelService.getTrackedTickers();
    } catch (err) {
      console.warn("[WheelStrategy] Could not fetch wheel tracker data for CC scan:", err);
      return [];
    }

    // Filter to positions with uncovered shares
    const uncovered = summaries.filter((s) => s.hasUncoveredShares && s.shareQuantity > 0);
    if (uncovered.length === 0) return [];

    const results: CcResultItem[] = [];

    await withLiveMarketData(async () => {
      for (const summary of uncovered) {
        try {
          const chain = await ibkrService.getOptionChain(summary.symbol);
          if (!chain || chain.length === 0) continue;

          const underlyingPrice = summary.currentPrice;
          if (!underlyingPrice) continue;

          // Filter strikes above current price (OTM calls)
          const filtered = filterChainByStrike(chain, underlyingPrice, 100, 120);

          const getDte = (exp: string): number => {
            const expDate = new Date(
              exp.substring(0, 4) + "-" + exp.substring(4, 6) + "-" + exp.substring(6, 8),
            );
            return Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          };

          // Filter by CC DTE range
          const dteFiltered = filtered.filter((entry) => {
            const dte = getDte(entry.expiration);
            return dte >= strategy.ccMinDte && dte <= strategy.ccMaxDte;
          });

          const callContracts = dteFiltered.map((entry) => ({ entry, contract: entry.call }));

          if (callContracts.length === 0) continue;

          const marketData = await ibkrService.getMarketDataBatch(
            callContracts.map((c) => c.contract),
          );

          let bestContract: CcResultItem["contract"] | null = null;
          let bestRoi = 0;

          for (const { entry } of callContracts) {
            const key = `${summary.symbol}_${entry.expiration}_${entry.strike}_CALL`;
            const data = marketData.get(key);
            if (!data) continue;

            const bid = data.bid ?? 0;
            const ask = data.ask ?? 0;
            if (bid <= 0) continue;

            const dte = getDte(entry.expiration);
            const metrics = calcOptionMetrics(bid, ask, entry.strike, dte);

            // Check minimum ROI if set
            if (strategy.ccMinRoi != null && metrics.premiumPercent < strategy.ccMinRoi) continue;

            if (metrics.premiumPercent > bestRoi) {
              bestRoi = metrics.premiumPercent;
              const expFormatted = `${entry.expiration.substring(0, 4)}-${entry.expiration.substring(4, 6)}-${entry.expiration.substring(6, 8)}`;
              bestContract = {
                strike: entry.strike,
                expiration: expFormatted,
                daysToExpiry: dte,
                delta: data.delta ?? null,
                bid,
                ask,
                midPrice: metrics.midPrice,
                premiumPercent: metrics.premiumPercent,
                annualizedReturn: metrics.annualizedReturn,
              };
            }
          }

          if (bestContract) {
            // Look up asset class assignment for this symbol
            const assignment = await prisma.securityAssignment.findFirst({
              where: { symbol: summary.symbol },
              include: { assetClass: true },
            });

            results.push({
              symbol: summary.symbol,
              assetClassId: assignment?.assetClassId ?? "",
              assetClassName: assignment?.assetClass?.name ?? "Unassigned",
              currentPrice: underlyingPrice,
              costBasis: summary.adjustedCostBasis,
              sharesHeld: summary.shareQuantity,
              contract: bestContract,
            });
          }
        } catch (err) {
          console.warn(`[WheelStrategy] CC scan failed for ${summary.symbol}:`, err);
        }
      }
    });

    console.log(`[WheelStrategy] CC scan: ${results.length} suggestions from ${uncovered.length} uncovered positions`);
    return results;
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
