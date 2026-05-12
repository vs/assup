import { prisma } from "../db/index.js";
import { PolygonProvider, type TickerDetails } from "./research/providers/polygon.provider.js";
import { historicalDataService } from "./historicalData.js";
import type { TickerProfileResponse } from "@assup/shared";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CONCURRENT_FETCHES = 2;

class TickerProfileService {
  private polygonProvider = new PolygonProvider();

  async getProfile(symbol: string): Promise<TickerProfileResponse> {
    const upperSymbol = symbol.toUpperCase();

    // Check for cached profile
    const cached = await prisma.tickerProfile.findUnique({
      where: { symbol: upperSymbol },
    });

    const cachedChart = await prisma.priceHistoryCache.findUnique({
      where: { symbol: upperSymbol },
    });

    const now = new Date();
    const profileFresh = cached && cached.expiresAt > now;
    const chartFresh = cachedChart && cachedChart.expiresAt > now;

    // If both caches are fresh, assemble from cache
    if (profileFresh && chartFresh) {
      const report = await prisma.researchReport.findFirst({
        where: { symbol: upperSymbol },
        orderBy: { createdAt: "desc" },
      });
      return this.assembleResponse(cached, cachedChart.data as any[], report?.recommendation ?? null, report?.confidence ?? null);
    }

    // Stale-while-revalidate: return stale if available, refresh in background
    if (cached && cachedChart) {
      this.refreshProfile(upperSymbol).catch((err) =>
        console.error(`Background refresh failed for ${upperSymbol}:`, err)
      );
      const report = await prisma.researchReport.findFirst({
        where: { symbol: upperSymbol },
        orderBy: { createdAt: "desc" },
      });
      return this.assembleResponse(cached, cachedChart.data as any[], report?.recommendation ?? null, report?.confidence ?? null);
    }

    // No cache at all — must fetch synchronously
    return this.fetchAndCacheProfile(upperSymbol);
  }

  async getBatchProfiles(
    symbols: string[]
  ): Promise<Record<string, TickerProfileResponse>> {
    const results: Record<string, TickerProfileResponse> = {};
    const toFetch: string[] = [];

    for (const symbol of symbols) {
      const upper = symbol.toUpperCase();
      const cached = await prisma.tickerProfile.findUnique({
        where: { symbol: upper },
      });
      const cachedChart = await prisma.priceHistoryCache.findUnique({
        where: { symbol: upper },
      });

      if (cached && cachedChart) {
        const now = new Date();
        const report = await prisma.researchReport.findFirst({
          where: { symbol: upper },
          orderBy: { createdAt: "desc" },
        });
        results[upper] = this.assembleResponse(
          cached,
          cachedChart.data as any[],
          report?.recommendation ?? null,
          report?.confidence ?? null,
        );
        if (cached.expiresAt <= now || cachedChart.expiresAt <= now) {
          this.refreshProfile(upper).catch((err) =>
            console.error(`Background refresh failed for ${upper}:`, err)
          );
        }
      } else {
        toFetch.push(upper);
      }
    }

    // Fetch missing profiles with concurrency limit
    const chunks = this.chunkArray(toFetch, MAX_CONCURRENT_FETCHES);
    for (const chunk of chunks) {
      const fetched = await Promise.allSettled(
        chunk.map((s) => this.fetchAndCacheProfile(s))
      );
      for (let i = 0; i < chunk.length; i++) {
        const result = fetched[i];
        if (result.status === "fulfilled") {
          results[chunk[i]] = result.value;
        }
      }
    }

    return results;
  }

  private async fetchAndCacheProfile(
    symbol: string
  ): Promise<TickerProfileResponse> {
    // 1. Check for research report (highest quality data)
    const report = await prisma.researchReport.findFirst({
      where: { symbol },
      orderBy: { createdAt: "desc" },
    });

    // 2. Fetch from Polygon.io
    let tickerDetails: TickerDetails | null = null;
    try {
      tickerDetails = await this.polygonProvider.getTickerDetails(symbol);
    } catch (err) {
      console.warn(`Polygon ticker details failed for ${symbol}:`, err);
    }

    // 3. Fetch chart data from TWS (3-year weekly bars)
    let chartData: { date: string; close: number }[] = [];
    try {
      chartData = await historicalDataService.getLongTermData(symbol, "3 Y");
    } catch (err) {
      console.warn(`TWS historical data failed for ${symbol}:`, err);
    }

    // 4. Check for recent fundamentals analysis
    let fundamentals: Record<string, any> | null = null;
    const recentAnalysis = await prisma.analysis.findFirst({
      where: {
        symbol,
        source: "fundamentals",
        analyzedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { analyzedAt: "desc" },
    });
    if (recentAnalysis) {
      fundamentals = recentAnalysis.details as Record<string, any>;
    }

    // 5. Fetch previous close price from Polygon (free plan compatible)
    let currentPrice: number | null = null;
    let previousClose: number | null = null;
    try {
      if (process.env.MARKET_DATA_API_KEY) {
        currentPrice = await this.polygonProvider.getPreviousClose(symbol);
      }
    } catch (err) {
      console.warn(`Polygon previous close failed for ${symbol}:`, err);
    }
    // Fallback: derive from chart data
    if (currentPrice == null && chartData.length > 0) {
      currentPrice = chartData[chartData.length - 1].close;
    }
    if (chartData.length >= 2) {
      previousClose = chartData[chartData.length - 2].close;
    }

    // 6. Assemble the profile — research report overrides Polygon data
    const companyOverview = report?.companyOverview as Record<string, any> | null;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);

    const profileData = {
      symbol,
      companyName: tickerDetails?.name || symbol,
      description:
        companyOverview?.description || tickerDetails?.description || "",
      sector: companyOverview?.sector || null,
      industry:
        companyOverview?.industry || tickerDetails?.industry || null,
      marketPosition: companyOverview?.marketPosition || null,
      marketCap:
        fundamentals?.fundamentals?.marketCap ??
        tickerDetails?.marketCap ??
        null,
      peRatio: fundamentals?.fundamentals?.pe ?? null,
      dividendYield: fundamentals?.fundamentals?.dividendYield ?? null,
      currentPrice,
      previousClose,
      fetchedAt: now,
      expiresAt,
    };

    // 7. Cache profile
    await prisma.tickerProfile.upsert({
      where: { symbol },
      create: profileData,
      update: profileData,
    });

    // 8. Cache chart data
    if (chartData.length > 0) {
      await prisma.priceHistoryCache.upsert({
        where: { symbol },
        create: {
          symbol,
          data: chartData,
          period: "3Y",
          fetchedAt: now,
          expiresAt,
        },
        update: {
          data: chartData,
          period: "3Y",
          fetchedAt: now,
          expiresAt,
        },
      });
    }

    return this.assembleResponse(profileData, chartData, report?.recommendation ?? null, report?.confidence ?? null);
  }

  private assembleResponse(
    profile: any,
    chartData: { date: string; close: number }[],
    recommendation: string | null,
    confidence: number | null,
  ): TickerProfileResponse {
    return {
      symbol: profile.symbol,
      companyName: profile.companyName,
      description: profile.description,
      sector: profile.sector,
      industry: profile.industry,
      marketPosition: profile.marketPosition,
      marketCap: profile.marketCap,
      peRatio: profile.peRatio,
      dividendYield: profile.dividendYield,
      currentPrice: profile.currentPrice ?? (chartData.length > 0 ? chartData[chartData.length - 1].close : null),
      previousClose: profile.previousClose ?? (chartData.length >= 2 ? chartData[chartData.length - 2].close : null),
      chart: chartData,
      recommendation: recommendation as any,
      confidence,
    };
  }

  private async refreshProfile(symbol: string): Promise<void> {
    await this.fetchAndCacheProfile(symbol);
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}

export const tickerProfileService = new TickerProfileService();
