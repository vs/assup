import { SecType } from "@stoqey/ib";
import { ibkrService } from "../../ibkr.js";
import { parseFundamentalRatiosTick } from "../providers/ibkr-xml-parser.js";
import { PolygonProvider } from "../providers/polygon.provider.js";
import type { CollectedData, Collector, CollectionResult } from "./types.js";

const STALENESS_MINUTES = 24 * 60; // 24 hours

async function collectFromIBKR(symbol: string): Promise<CollectionResult> {
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
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

async function collectFromPolygon(symbol: string): Promise<CollectionResult> {
  const polygon = new PolygonProvider();

  // Free-tier endpoints: ticker details, previous close, dividends
  const [details, price, dividends] = await Promise.all([
    polygon.getTickerDetails(symbol),
    polygon.getPreviousClose(symbol),
    polygon.getDividendCalendar(symbol),
  ]);

  // Paid-tier: financials (income statement, balance sheet, cash flow)
  // Try it but don't fail if the plan doesn't support it
  let financials: Awaited<ReturnType<typeof polygon.getFinancials>> = [];
  try {
    financials = await polygon.getFinancials(symbol, 2);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("403") || msg.includes("NOT_AUTHORIZED")) {
      console.log(`[fundamentals] ${symbol}: financials endpoint not available on current Polygon plan`);
    } else {
      throw err; // unexpected error — propagate
    }
  }

  const current = financials[0] ?? null;
  const previous = financials[1] ?? null;

  // Derive fundamentals from financial statements (if available)
  let pe: number | null = null;
  let eps: number | null = null;
  let epsGrowth: number | null = null;
  let revenue: number | null = null;
  let revenueGrowth: number | null = null;
  let profitMargin: number | null = null;
  let roe: number | null = null;
  let debtToEquity: number | null = null;
  let bookValue: number | null = null;
  let priceToBook: number | null = null;
  let priceToCashFlow: number | null = null;
  let dividendYield: number | null = null;
  let marketCap = details.marketCap;

  if (current) {
    eps = current.eps;
    revenue = current.revenue;
    const netIncome = current.netIncome;
    const equity = current.equity;
    const totalLiabilities = current.totalLiabilities;
    const shares = current.sharesOutstanding;
    const operatingCF = current.operatingCashFlow;

    if (price != null && eps != null && eps > 0) pe = price / eps;
    if (netIncome != null && revenue != null && revenue !== 0) profitMargin = (netIncome / revenue) * 100;
    if (netIncome != null && equity != null && equity !== 0) roe = (netIncome / equity) * 100;
    if (totalLiabilities != null && equity != null && equity !== 0) debtToEquity = (totalLiabilities / equity) * 100;
    if (equity != null && shares != null && shares > 0) bookValue = equity / shares;
    if (price != null && bookValue != null && bookValue > 0) priceToBook = price / bookValue;
    if (price != null && operatingCF != null && shares != null && shares > 0) {
      const cfPerShare = operatingCF / shares;
      if (cfPerShare !== 0) priceToCashFlow = price / cfPerShare;
    }
    if (marketCap == null && price != null && shares != null) marketCap = price * shares;
    if (previous) {
      epsGrowth = pctChange(eps, previous.eps);
      revenueGrowth = pctChange(revenue, previous.revenue);
    }
  }

  // Market cap fallback: ticker details shares × price
  if (marketCap == null && price != null && details.sharesOutstanding != null) {
    marketCap = price * details.sharesOutstanding;
  }

  // Dividend yield from trailing 12-month dividends
  if (price != null && price > 0 && dividends.length > 0) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recentDivs = dividends.filter((d) => new Date(d.exDate) >= oneYearAgo);
    if (recentDivs.length > 0) {
      const annualDiv = recentDivs.reduce((sum, d) => sum + d.amount, 0);
      dividendYield = (annualDiv / price) * 100;
    }
  }

  const dataPoints = [pe, eps, revenue, marketCap, dividendYield, roe, debtToEquity, profitMargin].filter((v) => v != null).length;
  console.log(`[fundamentals] ${symbol}: Polygon collected ${dataPoints} data points (marketCap=${marketCap != null}, divYield=${dividendYield != null}, pe=${pe != null})`);

  return {
    source: "fundamentals",
    data: {
      symbol,
      companyName: details.name,
      stockType: details.type,
      sector: {
        industry: details.industry,
        category: details.sector,
        subcategory: null,
      },
      fundamentals: {
        pe,
        forwardPe: null,
        eps,
        epsGrowth,
        dividendYield,
        revenue,
        marketCap,
        beta: null,
        roe,
        debtToEquity,
        profitMargin,
        revenueGrowth,
        bookValue,
        priceToBook,
        priceToCashFlow,
      },
      volatility: {
        historical30d: null,
        implied: null,
      },
      optionActivity: {
        callVolume: null,
        putVolume: null,
        callOI: null,
        putOI: null,
        putCallRatio: null,
      },
      shortable: {
        isShortable: null,
        sharesAvailable: null,
      },
      fetchedAt: new Date().toISOString(),
      dataSource: "polygon",
    },
    expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
  };
}

export const fundamentalsCollector: Collector = {
  source: "fundamentals",
  defaultSchedule: "0 18 * * 1-5", // Weekdays at 6 PM
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    // Try IBKR first (has richer data: volatility, options, short interest)
    let ibkrResult: CollectionResult | null = null;
    if (ibkrService.isConnected()) {
      ibkrResult = await collectFromIBKR(symbol);
      const fundamentals = (ibkrResult as CollectedData).data?.fundamentals as Record<string, unknown> | undefined;
      const hasData = fundamentals && Object.values(fundamentals).some((v) => v != null);
      if (hasData) {
        console.log(`[fundamentals] ${symbol}: collected from IBKR`);
        return ibkrResult;
      }
      console.log(`[fundamentals] ${symbol}: IBKR returned empty fundamentals (tick 258 likely rejected)`);
      // Fall through to Polygon, but keep IBKR result for non-fundamentals data
    }

    // Fall back to Polygon for fundamentals
    if (process.env.MARKET_DATA_API_KEY) {
      console.log(`[fundamentals] ${symbol}: using Polygon fallback`);
      const polygonResult = await collectFromPolygon(symbol);

      // Merge IBKR non-fundamentals data (volatility, options, shortable)
      // into Polygon result when IBKR was connected but tick 258 was rejected
      if (ibkrResult) {
        const ibkrData = (ibkrResult as CollectedData).data;
        const polygonData = (polygonResult as CollectedData).data;
        if (ibkrData && polygonData) {
          const ibkr = ibkrData as Record<string, unknown>;
          const poly = polygonData as Record<string, unknown>;
          // Keep IBKR's volatility, options, and shortable data if Polygon's are empty
          for (const key of ["volatility", "optionActivity", "shortable"] as const) {
            const polySection = poly[key] as Record<string, unknown> | undefined;
            const ibkrSection = ibkr[key] as Record<string, unknown> | undefined;
            if (ibkrSection && Object.values(ibkrSection).some((v) => v != null)) {
              if (!polySection || Object.values(polySection).every((v) => v == null)) {
                poly[key] = ibkrSection;
              }
            }
          }
          // Use IBKR sector info if Polygon doesn't have it
          const polySector = poly.sector as Record<string, unknown> | undefined;
          const ibkrSector = ibkr.sector as Record<string, unknown> | undefined;
          if (ibkrSector && Object.values(ibkrSector).some((v) => v != null)) {
            if (!polySector || Object.values(polySector).every((v) => v == null)) {
              poly.sector = ibkrSector;
            }
          }
          console.log(`[fundamentals] ${symbol}: merged IBKR non-fundamentals into Polygon data`);
        }
      }

      return polygonResult;
    }

    // If IBKR was connected but fundamentals were empty, still return it
    // (has volatility, options, shortable data even without tick 258)
    if (ibkrResult) {
      console.log(`[fundamentals] ${symbol}: using IBKR result without fundamentals (no Polygon key)`);
      return ibkrResult;
    }

    return {
      _tag: "skipped",
      source: "fundamentals",
      reason: "IBKR not connected and MARKET_DATA_API_KEY not set",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  },
};
