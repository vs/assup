import { SecType } from "@stoqey/ib";
import { ibkrService } from "../../ibkr.js";
import { parseFundamentalRatiosTick } from "../providers/ibkr-xml-parser.js";
import type { Collector, CollectionResult } from "./types.js";

const STALENESS_MINUTES = 24 * 60; // 24 hours

export const fundamentalsCollector: Collector = {
  source: "fundamentals",
  defaultSchedule: "0 18 * * 1-5", // Weekdays at 6 PM
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    if (!ibkrService.isConnected()) {
      return {
        _tag: "skipped",
        source: "fundamentals",
        reason: "IBKR not connected — fundamentals collector requires TWS",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // retry in 1h
      };
    }

    const contract = {
      symbol,
      secType: SecType.STK,
      exchange: "SMART",
      currency: "USD",
    };

    // Fetch contract details for sector classification
    let industry: string | null = null;
    let category: string | null = null;
    let subcategory: string | null = null;
    let longName: string | null = null;
    let stockType: string | null = null;

    try {
      const details = await ibkrService.getContractInfo(symbol);
      if (details.length > 0) {
        const d = details[0];
        industry = d.industry ?? null;
        category = d.category ?? null;
        subcategory = d.subcategory ?? null;
        longName = d.longName ?? null;
        stockType = d.stockType ?? null;
      }
    } catch {
      // Non-fatal: continue without sector data
    }

    // Fetch enhanced market data with fundamental ticks
    const enhanced = await ibkrService.getEnhancedMarketData(
      contract,
      "104,106,236,258,100,101"
    );

    // Parse fundamental ratios from tick 258
    const ratios = parseFundamentalRatiosTick(enhanced?.fundamentalRatios);

    return {
      source: "fundamentals",
      data: {
        symbol,
        companyName: longName,
        stockType,
        sector: {
          industry,
          category,
          subcategory,
        },
        fundamentals: {
          pe: ratios.pe,
          forwardPe: ratios.forwardPe,
          eps: ratios.eps,
          epsGrowth: ratios.epsGrowth,
          dividendYield: ratios.dividendYield,
          revenue: ratios.revenue,
          marketCap: ratios.marketCap,
          beta: ratios.beta,
          roe: ratios.roe,
          debtToEquity: ratios.debtToEquity,
          profitMargin: ratios.profitMargin,
          revenueGrowth: ratios.revenueGrowth,
          bookValue: ratios.bookValue,
          priceToBook: ratios.priceToBook,
          priceToCashFlow: ratios.priceToCashFlow,
        },
        volatility: {
          historical30d: enhanced?.historicalVolatility ?? null,
          implied: enhanced?.impliedVolatility ?? null,
        },
        optionActivity: {
          callVolume: enhanced?.callVolume ?? null,
          putVolume: enhanced?.putVolume ?? null,
          callOI: enhanced?.callOpenInterest ?? null,
          putOI: enhanced?.putOpenInterest ?? null,
          putCallRatio:
            enhanced?.callVolume && enhanced.callVolume > 0 && enhanced?.putVolume != null
              ? enhanced.putVolume / enhanced.callVolume
              : null,
        },
        shortable: {
          isShortable: enhanced?.shortableIndicator != null ? enhanced.shortableIndicator > 2.5 : null,
          sharesAvailable: enhanced?.shortableShares ?? null,
        },
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
