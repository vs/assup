import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import { sseService } from "./sse.js";
import { getMarketDataProvider } from "./research/providers/index.js";
import {
  scoreIvRank,
  scorePutLiquidity,
  scorePremiumYield,
  scoreMarketCap,
  scorePriceRange,
  scoreAllocationNeed,
  computeCompositeScore,
} from "./wheelScanner.scoring.js";
import { pipelineService } from "./research/pipeline.service.js";
import { getUnderinvestedClasses } from "./allocation.service.js";
import { sleep } from "../utils/market.js";

interface CandidateInfo {
  symbol: string;
  assetClassId: string;
  source: "seed" | "discovery";
  marketCap: number | null;
  lastPrice: number | null;
}

interface ScoredCandidate {
  candidate: CandidateInfo;
  score: number;
  ivRank: number | null;
  putLiquidity: number | null;
  premiumYield: number | null;
}

const TOP_N_PER_CLASS = 3;
const REPORT_FRESHNESS_DAYS = 7;
const IBKR_BATCH_SIZE = 3;
const IBKR_BATCH_DELAY_MS = 2000;

class WheelScannerService {
  /** Trigger a new scan. Returns scan ID. Runs in background. */
  async startScan(): Promise<string> {
    const scan = await prisma.wheelScan.create({
      data: { status: "pending" },
    });

    this.runScan(scan.id).catch((err) => {
      console.error(`Wheel scan ${scan.id} failed:`, err);
      prisma.wheelScan
        .update({
          where: { id: scan.id },
          data: {
            status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
            completedAt: new Date(),
          },
        })
        .catch(console.error);
    });

    return scan.id;
  }

  private async runScan(scanId: string): Promise<void> {
    await prisma.wheelScan.update({
      where: { id: scanId },
      data: { status: "running", startedAt: new Date() },
    });

    // 1. Get underinvested classes
    const underinvested = await getUnderinvestedClasses();

    if (underinvested.length === 0) {
      await prisma.wheelScan.update({
        where: { id: scanId },
        data: {
          status: "completed",
          completedAt: new Date(),
          errorMessage: "No underinvested asset classes found. Check that you have an active allocation profile with targets set.",
        },
      });
      return;
    }

    // 2. Get scan configs for underinvested classes
    const allConfigs = await prisma.wheelScanConfig.findMany({
      where: { enabled: true },
    });

    const configs = allConfigs.filter((c) =>
      underinvested.some((u) => u.id === c.assetClassId)
    );

    if (configs.length === 0) {
      const underNames = underinvested.map((u) => u.name).join(", ");
      const configNames = allConfigs.length > 0
        ? "Your configs are for other asset classes."
        : "No scan configs exist.";
      await prisma.wheelScan.update({
        where: { id: scanId },
        data: {
          status: "completed",
          completedAt: new Date(),
          errorMessage: `No scan configs match underinvested classes. Underinvested: ${underNames}. ${configNames}`,
        },
      });
      return;
    }

    // Build shortfall map (percentage points below target)
    const shortfallMap = new Map(
      underinvested.map((u) => [u.id, Math.abs(u.difference)])
    );

    // 3. Discovery phase
    this.emitProgress(scanId, "discovery", 0, configs.length);

    const candidates: CandidateInfo[] = [];
    const provider = getMarketDataProvider();

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];

      // Add seed tickers
      for (const symbol of config.seedTickers) {
        if (!candidates.some((c) => c.symbol === symbol)) {
          candidates.push({
            symbol,
            assetClassId: config.assetClassId,
            source: "seed",
            marketCap: null,
            lastPrice: null,
          });
        }
      }

      // Polygon discovery via keywords
      for (const keyword of config.searchKeywords) {
        try {
          const results = await provider.searchTickers({
            search: keyword,
            type: "CS",
            active: true,
            limit: 50,
          });

          for (const r of results) {
            if (candidates.some((c) => c.symbol === r.symbol)) continue;

            // Apply price and market cap filters from config
            if (r.lastPrice != null && (r.lastPrice < config.minPrice || r.lastPrice > config.maxPrice)) continue;
            if (r.marketCap != null && r.marketCap < config.minMarketCap) continue;

            candidates.push({
              symbol: r.symbol,
              assetClassId: config.assetClassId,
              source: "discovery",
              marketCap: r.marketCap ?? null,
              lastPrice: r.lastPrice ?? null,
            });
          }
        } catch (err) {
          console.warn(
            `Polygon search failed for keyword "${keyword}":`,
            err
          );
        }
      }

      this.emitProgress(scanId, "discovery", i + 1, configs.length);
    }

    // Cap candidates per class
    const maxPerClass = 30;
    const cappedCandidates = this.capPerClass(candidates, maxPerClass);

    await prisma.wheelScan.update({
      where: { id: scanId },
      data: { totalCandidates: cappedCandidates.length },
    });

    // 4. Scoring phase - requires IBKR connection for options data
    this.emitProgress(scanId, "scoring", 0, cappedCandidates.length);

    const results: ScoredCandidate[] = [];

    if (ibkrService.isConnected()) {
      for (let i = 0; i < cappedCandidates.length; i += IBKR_BATCH_SIZE) {
        const batch = cappedCandidates.slice(i, i + IBKR_BATCH_SIZE);

        const batchResults = await Promise.allSettled(
          batch.map((c) => this.scoreCandidate(c, shortfallMap))
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled" && result.value) {
            results.push(result.value);
          }
        }

        this.emitProgress(
          scanId,
          "scoring",
          Math.min(i + IBKR_BATCH_SIZE, cappedCandidates.length),
          cappedCandidates.length
        );

        if (i + IBKR_BATCH_SIZE < cappedCandidates.length) {
          await sleep(IBKR_BATCH_DELAY_MS);
        }
      }
    } else {
      // Without IBKR, score based on available data only (market cap, price, allocation need)
      for (const c of cappedCandidates) {
        const shortfall = shortfallMap.get(c.assetClassId) ?? 0;
        const score = computeCompositeScore({
          ivRank: 0,
          putLiquidity: 0,
          premiumYield: 0,
          marketCap: scoreMarketCap(c.marketCap ?? 0),
          priceRange: scorePriceRange(c.lastPrice ?? 0),
          allocationNeed: scoreAllocationNeed(shortfall),
        });
        results.push({
          candidate: c,
          score,
          ivRank: null,
          putLiquidity: null,
          premiumYield: null,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Store results
    if (results.length > 0) {
      await prisma.wheelScanResult.createMany({
        data: results.map((r) => ({
          scanId,
          symbol: r.candidate.symbol,
          assetClassId: r.candidate.assetClassId,
          source: r.candidate.source,
          compositeScore: r.score,
          ivRank: r.ivRank,
          putLiquidity: r.putLiquidity,
          premiumYield: r.premiumYield,
          marketCap: r.candidate.marketCap,
          lastPrice: r.candidate.lastPrice,
          allocationNeed: shortfallMap.get(r.candidate.assetClassId) ?? null,
        })),
      });
    }

    await prisma.wheelScan.update({
      where: { id: scanId },
      data: { scoredCandidates: results.length },
    });

    // 5. Report generation for top N per class
    const topPerClass = this.selectTopPerClass(results, TOP_N_PER_CLASS);
    let reportsTriggered = 0;

    this.emitProgress(scanId, "reports", 0, topPerClass.length);

    for (let i = 0; i < topPerClass.length; i++) {
      const r = topPerClass[i];
      try {
        const recentReport = await prisma.researchReport.findFirst({
          where: {
            ticker: { symbol: r.candidate.symbol },
            createdAt: {
              gte: new Date(
                Date.now() - REPORT_FRESHNESS_DAYS * 86400000
              ),
            },
          },
        });

        if (!recentReport) {
          await pipelineService.generateReport(r.candidate.symbol);
          reportsTriggered++;

          await prisma.wheelScanResult.updateMany({
            where: { scanId, symbol: r.candidate.symbol },
            data: { reportTriggered: true },
          });
        }
      } catch (err) {
        console.warn(
          `Failed to trigger report for ${r.candidate.symbol}:`,
          err
        );
      }

      this.emitProgress(scanId, "reports", i + 1, topPerClass.length);
    }

    // Complete
    await prisma.wheelScan.update({
      where: { id: scanId },
      data: {
        status: "completed",
        reportsTriggered,
        completedAt: new Date(),
      },
    });
  }

  private async scoreCandidate(
    candidate: CandidateInfo,
    shortfallMap: Map<string, number>
  ): Promise<ScoredCandidate | null> {
    try {
      // Get option chain from IBKR
      const chain = await ibkrService.getOptionChain(candidate.symbol);
      if (!chain || chain.length === 0) return null;

      // Filter to 30-60 DTE
      const now = Date.now();
      const minDte = 30;
      const maxDte = 60;

      const relevantEntries = chain.filter((entry) => {
        const exp = new Date(entry.expiration).getTime();
        const dte = (exp - now) / 86400000;
        return dte >= minDte && dte <= maxDte;
      });

      if (relevantEntries.length === 0) return null;

      // Get market data for put contracts
      const putContracts = relevantEntries.map((e) => e.put);
      const marketDataMap = await ibkrService.getMarketDataBatch(putContracts);

      // Collect market data values
      const tickerDataArray = Array.from(marketDataMap.values());
      if (tickerDataArray.length === 0) return null;

      // Calculate put liquidity (avg bid-ask spread %)
      const spreads = tickerDataArray
        .filter(
          (td) =>
            td.bid != null && td.ask != null && td.bid > 0 && td.ask > 0
        )
        .map((td) => (td.ask! - td.bid!) / ((td.bid! + td.ask!) / 2));
      const avgSpreadPct =
        spreads.length > 0
          ? spreads.reduce((a, b) => a + b, 0) / spreads.length
          : 1;

      // Use delta from IBKR market data as proxy for IV rank
      // Higher absolute delta on OTM puts suggests higher IV
      const deltas = tickerDataArray
        .map((td) => Math.abs(td.delta ?? 0))
        .filter((d) => d > 0);
      const avgDelta =
        deltas.length > 0
          ? deltas.reduce((a, b) => a + b, 0) / deltas.length
          : 0;
      // Approximate IV rank: higher avg delta on OTM puts = higher IV environment
      const ivRankApprox = Math.min(avgDelta * 300, 100);

      // Calculate best annualized premium yield from ~25 delta puts
      let bestAnnualizedReturn = 0;
      for (const entry of relevantEntries) {
        const td = marketDataMap.get(String(entry.put.conId ?? ""));
        if (!td || !td.bid || td.bid <= 0) continue;

        const absDelta = Math.abs(td.delta ?? 0);
        if (absDelta < 0.15 || absDelta > 0.35) continue;

        const midPrice = ((td.bid ?? 0) + (td.ask ?? td.bid ?? 0)) / 2;
        const strike = entry.strike;
        if (strike <= 0) continue;

        const exp = new Date(entry.expiration).getTime();
        const dte = Math.max((exp - now) / 86400000, 1);
        const premiumPct = (midPrice / strike) * 100;
        const annualized = (premiumPct * 365) / dte;
        bestAnnualizedReturn = Math.max(bestAnnualizedReturn, annualized);
      }

      // Get last price from any market data or use candidate's
      const lastPrice =
        candidate.lastPrice ??
        tickerDataArray.find((td) => td.last != null)?.last ??
        null;

      const shortfall = shortfallMap.get(candidate.assetClassId) ?? 0;

      const factors = {
        ivRank: scoreIvRank(ivRankApprox),
        putLiquidity: scorePutLiquidity(avgSpreadPct),
        premiumYield: scorePremiumYield(bestAnnualizedReturn),
        marketCap: scoreMarketCap(candidate.marketCap ?? 0),
        priceRange: scorePriceRange(lastPrice ?? 0),
        allocationNeed: scoreAllocationNeed(shortfall),
      };

      return {
        candidate: { ...candidate, lastPrice },
        score: computeCompositeScore(factors),
        ivRank: ivRankApprox,
        putLiquidity: avgSpreadPct,
        premiumYield: bestAnnualizedReturn,
      };
    } catch (err) {
      console.warn(`Failed to score ${candidate.symbol}:`, err);
      return null;
    }
  }

  private capPerClass(
    candidates: CandidateInfo[],
    maxPerClass: number
  ): CandidateInfo[] {
    const countByClass = new Map<string, number>();
    return candidates.filter((c) => {
      const count = countByClass.get(c.assetClassId) ?? 0;
      if (count >= maxPerClass) return false;
      countByClass.set(c.assetClassId, count + 1);
      return true;
    });
  }

  private selectTopPerClass(
    results: ScoredCandidate[],
    topN: number
  ): ScoredCandidate[] {
    const byClass = new Map<string, ScoredCandidate[]>();
    for (const r of results) {
      const list = byClass.get(r.candidate.assetClassId) ?? [];
      list.push(r);
      byClass.set(r.candidate.assetClassId, list);
    }
    const top: ScoredCandidate[] = [];
    for (const [, list] of byClass) {
      top.push(...list.slice(0, topN));
    }
    return top;
  }

  private emitProgress(
    scanId: string,
    phase: string,
    current: number,
    total: number
  ) {
    try {
      sseService.broadcast("wheel_scanner", {
        scanId,
        phase,
        current,
        total,
      });
    } catch {
      // SSE broadcast is best-effort
    }
  }

  // --- Config management ---

  async getConfigs() {
    return prisma.wheelScanConfig.findMany({
      include: { assetClass: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async upsertConfig(data: {
    assetClassId: string;
    searchKeywords: string[];
    seedTickers: string[];
    minPrice?: number;
    maxPrice?: number;
    minMarketCap?: number;
    enabled?: boolean;
  }) {
    return prisma.wheelScanConfig.upsert({
      where: { assetClassId: data.assetClassId },
      create: data,
      update: data,
    });
  }

  async deleteConfig(id: string) {
    return prisma.wheelScanConfig.delete({ where: { id } });
  }

  // --- Scan results ---

  async getScans(limit = 10) {
    return prisma.wheelScan.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        results: {
          orderBy: { compositeScore: "desc" },
          take: 50,
        },
      },
    });
  }

  async getScan(id: string) {
    return prisma.wheelScan.findUnique({
      where: { id },
      include: {
        results: {
          orderBy: { compositeScore: "desc" },
        },
      },
    });
  }
}

export const wheelScannerService = new WheelScannerService();
