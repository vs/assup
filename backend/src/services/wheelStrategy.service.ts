// backend/src/services/wheelStrategy.service.ts
import { prisma } from "../db/index.js";
import { sseService } from "./sse.js";
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
  private async phaseDiscovery(_scanId: string, _strategy: any): Promise<DiscoveredTicker[]> {
    return [];
  }

  private async phaseFundamentals(_scanId: string, _strategy: any, _tickers: DiscoveredTicker[], _skipped: SkippedTicker[]): Promise<FundamentalTicker[]> {
    return [];
  }

  private async phaseEarnings(_scanId: string, _strategy: any, _tickers: FundamentalTicker[], _skipped: SkippedTicker[]): Promise<EarningsSafeTicker[]> {
    return [];
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
