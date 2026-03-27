import { SecType, BarSizeSetting, WhatToShow, OptionType } from "@stoqey/ib";
import { ibkrService } from "../../ibkr.js";
import type {
  MarketDataProvider,
  OHLCV,
  QuoteData,
  OptionsChainEntry,
  EarningsEvent,
  DividendEvent,
  AnalystRating,
  TickerSearchResult,
} from "./types.js";
import {
  parseReportSnapshot,
  parseRESC,
  parseDividendTick,
} from "./ibkr-xml-parser.js";

function stockContract(symbol: string) {
  return { symbol, secType: SecType.STK, exchange: "SMART", currency: "USD" };
}

class IBKRProvider implements MarketDataProvider {
  name = "ibkr";

  async getQuote(symbol: string): Promise<QuoteData> {
    const data = await ibkrService.getMarketData(stockContract(symbol));
    if (!data) {
      throw new Error(`No market data from IBKR for ${symbol}`);
    }
    return {
      symbol,
      last: data.last ?? null,
      close: data.close ?? null,
      open: null, // Not available from snapshot
      high: null,
      low: null,
      volume: null,
    };
  }

  async getHistoricalOHLCV(
    symbol: string,
    from: string,
    to: string,
    timespan: "day" | "week" | "month" = "day"
  ): Promise<OHLCV[]> {
    // Calculate duration from date range
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));

    let duration: string;
    if (diffDays <= 365) {
      duration = `${diffDays} D`;
    } else {
      const years = Math.ceil(diffDays / 365);
      duration = `${years} Y`;
    }

    const barSize: BarSizeSetting = timespan === "month"
      ? BarSizeSetting.MONTHS_ONE
      : timespan === "week"
        ? BarSizeSetting.WEEKS_ONE
        : BarSizeSetting.DAYS_ONE;

    // IBKR endDateTime format: YYYYMMDD HH:MM:SS [timezone]
    const endDateTime = to.replace(/-/g, "") + " 23:59:59";

    const bars = await ibkrService.getHistoricalData({
      contract: stockContract(symbol),
      endDateTime,
      duration,
      barSizeSetting: barSize,
      whatToShow: WhatToShow.TRADES,
      useRth: 1,
      formatDate: 1, // YYYYMMDD format
    });

    return bars.map((bar) => {
      // bar.time is YYYYMMDD when formatDate=1
      const t = String(bar.time);
      const date = t.length === 8
        ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
        : t;
      return {
        date,
        open: bar.open ?? 0,
        high: bar.high ?? 0,
        low: bar.low ?? 0,
        close: bar.close ?? 0,
        volume: bar.volume ?? 0,
      };
    });
  }

  async getOptionsChain(
    symbol: string,
    expirations = 4
  ): Promise<OptionsChainEntry[]> {
    const chain = await ibkrService.getOptionChain(symbol);
    if (chain.length === 0) return [];

    // Get unique expirations sorted, take nearest N
    const uniqueExpiries = [...new Set(chain.map((e) => e.expiration))].sort();
    const targetExpiries = new Set(uniqueExpiries.slice(0, expirations));

    // Filter to target expirations
    const filtered = chain.filter((e) => targetExpiries.has(e.expiration));

    // Collect all contracts (calls + puts) for batch market data
    const contracts = filtered.flatMap((e) => [e.call, e.put]);

    // Fetch market data for all option contracts
    const marketData = await ibkrService.getMarketDataBatch(contracts);

    // Build OptionsChainEntry for each contract
    const entries: OptionsChainEntry[] = [];
    for (const entry of filtered) {
      for (const [right, contract] of [["C", entry.call], ["P", entry.put]] as const) {
        const key = `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
        const md = marketData.get(key);

        // Format expiration from YYYYMMDD to YYYY-MM-DD
        const exp = entry.expiration;
        const expFormatted = exp.length === 8
          ? `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}`
          : exp;

        entries.push({
          symbol,
          expiration: expFormatted,
          strike: entry.strike,
          right,
          bid: md?.bid ?? 0,
          ask: md?.ask ?? 0,
          last: md?.last ?? 0,
          volume: 0, // Not available from snapshot
          openInterest: 0,
          impliedVolatility: null,
          delta: md?.delta ?? null,
          gamma: null,
          theta: null,
        });
      }
    }

    return entries;
  }

  async getEarningsCalendar(symbol: string): Promise<EarningsEvent[]> {
    try {
      const xml = await ibkrService.getFundamentalData(symbol, "ReportSnapshot");
      if (!xml) return [];

      const parsed = parseReportSnapshot(xml);
      return parsed.earningsDates.map((e) => ({
        symbol,
        date: e.date,
        estimateEps: null,
        actualEps: e.eps,
        quarter: e.quarter,
      }));
    } catch {
      return [];
    }
  }

  async getDividendCalendar(symbol: string): Promise<DividendEvent[]> {
    try {
      const enhanced = await ibkrService.getEnhancedMarketData(
        stockContract(symbol),
        "456"
      );
      if (!enhanced?.ibDividends) return [];

      const parsed = parseDividendTick(enhanced.ibDividends);
      const events: DividendEvent[] = [];

      if (parsed.nextDate && parsed.annualAmount !== null) {
        // Estimate quarterly from annual (most common US frequency)
        const frequency = parsed.annualAmount > 0 ? "quarterly" : null;
        const quarterlyAmount = parsed.annualAmount ? parsed.annualAmount / 4 : 0;

        events.push({
          symbol,
          exDate: parsed.nextDate,
          payDate: null,
          amount: quarterlyAmount || parsed.annualAmount || 0,
          frequency,
        });
      }

      return events;
    } catch {
      return [];
    }
  }

  async getAnalystRatings(symbol: string): Promise<AnalystRating[]> {
    try {
      const xml = await ibkrService.getFundamentalData(symbol, "RESC");
      if (!xml) return [];

      const parsed = parseRESC(xml);
      return parsed.analysts.map((a) => ({
        firm: a.firm,
        rating: a.rating,
        priceTarget: a.priceTarget,
        date: a.date,
        action: "reiterate",
      }));
    } catch {
      return [];
    }
  }

  async searchTickers(criteria: {
    market?: string;
    type?: string;
    search?: string;
    active?: boolean;
    limit?: number;
  }): Promise<TickerSearchResult[]> {
    if (!criteria.search) return [];

    const descriptions = await ibkrService.searchSymbols(criteria.search);
    const limit = criteria.limit || 100;

    return descriptions.slice(0, limit).map((desc) => ({
      symbol: desc.contract?.symbol ?? "",
      name: desc.contract?.symbol ?? "", // ContractDescription doesn't include longName
      market: "stocks",
      type: desc.contract?.secType === "STK" ? "CS" : (desc.contract?.secType ?? ""),
      active: true,
      marketCap: null,
      lastPrice: null,
    }));
  }
}

export function createIBKRProvider(): MarketDataProvider {
  return new IBKRProvider();
}
