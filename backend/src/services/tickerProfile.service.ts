import { prisma } from "../db/index.js";
import { PolygonProvider, type TickerDetails } from "./research/providers/polygon.provider.js";
import type { TickerProfileResponse } from "@assup/shared";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CONCURRENT_FETCHES = 5;

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
      return this.assembleResponse(cached, cachedChart.data as any[], upperSymbol);
    }

    // Stale-while-revalidate: return stale if available, refresh in background
    if (cached && cachedChart) {
      this.refreshProfile(upperSymbol).catch((err) =>
        console.error(`Background refresh failed for ${upperSymbol}:`, err)
      );
      return this.assembleResponse(cached, cachedChart.data as any[], upperSymbol);
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
        results[upper] = await this.assembleResponse(
          cached,
          cachedChart.data as any[],
          upper
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

    // 3. Fetch chart data from Polygon.io
    let chartData: { date: string; close: number }[] = [];
    try {
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      const from = threeYearsAgo.toISOString().split("T")[0];
      const to = new Date().toISOString().split("T")[0];
      const ohlcv = await this.polygonProvider.getHistoricalOHLCV(
        symbol,
        from,
        to,
        "day"
      );
      chartData = ohlcv.map((d) => ({ date: d.date, close: d.close }));
    } catch (err) {
      console.warn(`Polygon historical data failed for ${symbol}:`, err);
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

    // 5. Assemble the profile — research report overrides Polygon data
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
      fetchedAt: now,
      expiresAt,
    };

    // 6. Cache profile
    await prisma.tickerProfile.upsert({
      where: { symbol },
      create: profileData,
      update: profileData,
    });

    // 7. Cache chart data
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

    return this.assembleResponse(profileData, chartData, symbol);
  }

  private async assembleResponse(
    profile: any,
    chartData: { date: string; close: number }[],
    symbol: string
  ): Promise<TickerProfileResponse> {
    const report = await prisma.researchReport.findFirst({
      where: { symbol },
      orderBy: { createdAt: "desc" },
    });

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
      chart: chartData,
      recommendation: (report?.recommendation as any) ?? null,
      confidence: report?.confidence ?? null,
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
