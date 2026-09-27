import { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";
import { PolygonProvider } from "./research/providers/polygon.provider.js";
import { getMacroEvents } from "./macroCalendar.provider.js";
import { ibkrService } from "./ibkr.js";
import { fetchFinnhubEarnings, isFinnhubConfigured } from "./finnhub.client.js";
import {
  DEFAULT_MARKET_WIDE_SYMBOLS,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarSettings,
} from "@assup/shared";

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Scheduled 6-hourly sync: nobody is waiting on it, so it queues behind
// anything a user or a report pipeline asked for.
const polygon = new PolygonProvider({ priority: "background" });

/** Uppercase, trim, drop blanks, de-duplicate — preserving first-seen order. */
function normalizeSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push(symbol);
  }
  return result;
}

export class CalendarService {
  async getEvents(
    startDate: string,
    endDate: string,
    filters?: { types?: CalendarEventType[]; symbol?: string }
  ): Promise<CalendarEvent[]> {
    const settings = await this.getSettings();
    const excluded = settings.excludedEventTypes;
    const where: Record<string, unknown> = {
      date: { gte: new Date(startDate), lte: new Date(endDate) },
      ...(excluded.length > 0 && { eventType: { notIn: excluded } }),
      ...(filters?.types && { eventType: { in: filters.types, notIn: excluded } }),
      ...(filters?.symbol && { symbol: filters.symbol }),
    };

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: { date: "asc" },
    });

    const portfolioSymbols = await this.getPortfolioSymbolSet();
    const marketWideSymbols = new Set(settings.marketWideSymbols);

    const mapped = events
      .map((e) => ({
        row: e,
        verdict: this.classifyEvent(
          e,
          portfolioSymbols,
          marketWideSymbols,
          settings.includeMarketWideEarnings
        ),
      }))
      .filter(({ verdict }) => verdict.visible)
      .map(({ row, verdict }) => ({
        id: row.id,
        eventType: row.eventType as CalendarEventType,
        symbol: row.symbol,
        date: row.date.toISOString().split("T")[0],
        title: row.title,
        details: row.details as Record<string, unknown> | null,
        source: row.source,
        sourceId: row.sourceId,
        marketWide: verdict.marketWide,
      }));
    return this.filterSpreadExpirations(mapped);
  }

  async getEventsBySymbol(symbol: string, limit = 5): Promise<CalendarEvent[]> {
    const excluded = await this.getExcludedTypes();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const events = await prisma.calendarEvent.findMany({
      where: {
        symbol,
        date: { gte: today },
        ...(excluded.length > 0 && { eventType: { notIn: excluded } }),
      },
      orderBy: { date: "asc" },
      take: limit,
    });

    const portfolioSymbols = await this.getPortfolioSymbolSet();
    const mapped = events.map((e) => ({
      id: e.id,
      eventType: e.eventType as CalendarEventType,
      symbol: e.symbol,
      date: e.date.toISOString().split("T")[0],
      title: e.title,
      details: e.details as Record<string, unknown> | null,
      source: e.source,
      sourceId: e.sourceId,
      marketWide: Boolean(e.symbol) && !portfolioSymbols.has(e.symbol!),
    }));
    return this.filterSpreadExpirations(mapped);
  }

  async getTodayAndUpcoming(days = 5): Promise<CalendarEvent[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    return this.getEvents(fmt(today), fmt(endDate));
  }

  async syncAll(): Promise<void> {
    console.log("[CalendarSync] Starting full sync...");
    const symbols = await this.getTrackedSymbols();
    console.log(`[CalendarSync] Syncing ${symbols.length} symbols`);

    if (!(await isFinnhubConfigured())) {
      console.warn(
        "[CalendarSync] Finnhub API key not configured — earnings events will not be synced"
      );
    }

    // Sync each source independently — one failure shouldn't block others
    try {
      await this.syncMacroEvents();
    } catch (error) {
      console.error("[CalendarSync] Error syncing macro events:", error);
    }

    try {
      await this.syncOptionExpirations();
    } catch (error) {
      console.error("[CalendarSync] Error syncing option expirations:", error);
    }

    try {
      await this.syncMarketWideEarnings();
    } catch (error) {
      console.error("[CalendarSync] Error syncing market-wide earnings:", error);
    }

    for (const symbol of symbols) {
      await this.syncTickerFromPolygon(symbol);
    }

    console.log("[CalendarSync] Full sync complete");
  }

  async syncTickerFromPolygon(symbol: string): Promise<void> {
    const status = await prisma.calendarSyncStatus.findUnique({
      where: { source_symbol: { source: "polygon", symbol: symbol } },
    });

    if (status && status.nextSyncAt > new Date()) {
      return; // Not due for sync yet
    }

    try {
      // Earnings come from Finnhub: Polygon's financials endpoint returns
      // historical SEC filings, not upcoming announcement dates.
      if (await isFinnhubConfigured()) {
        try {
          await this.syncEarningsForSymbol(symbol);
        } catch (err) {
          console.error(`[CalendarSync] Finnhub earnings sync failed for ${symbol}:`, err);
        }
      }

      // Fetch dividends
      const dividends = await polygon.getDividendCalendar(symbol);
      for (const d of dividends) {
        // Ex-dividend date
        if (d.exDate) {
          await prisma.calendarEvent.upsert({
            where: { source_sourceId: { source: "polygon", sourceId: `div_ex:${symbol}:${d.exDate}` } },
            create: {
              eventType: "DIVIDEND_EX_DATE",
              symbol,
              date: new Date(d.exDate),
              title: `${symbol} Ex-Dividend`,
              details: { amount: d.amount, frequency: d.frequency },
              source: "polygon",
              sourceId: `div_ex:${symbol}:${d.exDate}`,
            },
            update: {
              title: `${symbol} Ex-Dividend`,
              details: { amount: d.amount, frequency: d.frequency },
            },
          });
        }
        // Payment date
        if (d.payDate) {
          await prisma.calendarEvent.upsert({
            where: { source_sourceId: { source: "polygon", sourceId: `div_pay:${symbol}:${d.payDate}` } },
            create: {
              eventType: "DIVIDEND_PAYMENT",
              symbol,
              date: new Date(d.payDate),
              title: `${symbol} Dividend Payment`,
              details: { amount: d.amount, frequency: d.frequency },
              source: "polygon",
              sourceId: `div_pay:${symbol}:${d.payDate}`,
            },
            update: {
              title: `${symbol} Dividend Payment`,
              details: { amount: d.amount, frequency: d.frequency },
            },
          });
        }
      }

      // Fetch stock splits
      const splits = await polygon.getStockSplits(symbol);
      for (const s of splits) {
        await prisma.calendarEvent.upsert({
          where: { source_sourceId: { source: "polygon", sourceId: `split:${symbol}:${s.executionDate}` } },
          create: {
            eventType: "STOCK_SPLIT",
            symbol,
            date: new Date(s.executionDate),
            title: `${symbol} ${s.splitTo}:${s.splitFrom} Stock Split`,
            details: { splitFrom: s.splitFrom, splitTo: s.splitTo },
            source: "polygon",
            sourceId: `split:${symbol}:${s.executionDate}`,
          },
          update: {
            title: `${symbol} ${s.splitTo}:${s.splitFrom} Stock Split`,
            details: { splitFrom: s.splitFrom, splitTo: s.splitTo },
          },
        });
      }

      // Update sync status
      const now = new Date();
      await prisma.calendarSyncStatus.upsert({
        where: { source_symbol: { source: "polygon", symbol: symbol } },
        create: {
          source: "polygon",
          symbol,
          lastSyncAt: now,
          nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
        },
        update: {
          lastSyncAt: now,
          nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
        },
      });
    } catch (error) {
      console.error(`[CalendarSync] Error syncing ${symbol} from Polygon:`, error);
    }
  }

  /**
   * Fetch and upsert Finnhub earnings for one symbol.
   *
   * Shared by the per-holding Polygon sync and the market-wide sync so both
   * write the same `finnhub`/`earnings:{symbol}:{date}` row — a symbol moving
   * between held and market-wide updates one event instead of duplicating it.
   */
  private async syncEarningsForSymbol(symbol: string): Promise<void> {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 180);
    const fmt = (d: Date) => d.toISOString().split("T")[0];

    const earnings = await fetchFinnhubEarnings(symbol, fmt(fromDate), fmt(toDate));
    for (const e of earnings) {
      if (!e.date) continue;
      const hourLabel =
        e.hour === "bmo" ? "Before Open" :
        e.hour === "amc" ? "After Close" :
        e.hour === "dmh" ? "During Market" : null;
      const quarter = `Q${e.quarter} ${e.year}`;
      const title = `${symbol} ${quarter} Earnings${hourLabel ? ` (${hourLabel})` : ""}`;
      const details = {
        estimateEps: e.epsEstimate,
        actualEps: e.epsActual,
        quarter,
        hour: e.hour || null,
        revenueEstimate: e.revenueEstimate,
        revenueActual: e.revenueActual,
      };
      await prisma.calendarEvent.upsert({
        where: { source_sourceId: { source: "finnhub", sourceId: `earnings:${symbol}:${e.date}` } },
        create: {
          eventType: "EARNINGS",
          symbol,
          date: new Date(e.date),
          title,
          details,
          source: "finnhub",
          sourceId: `earnings:${symbol}:${e.date}`,
        },
        update: { title, details },
      });
    }
  }

  /**
   * Sync earnings for symbols the user tracks for market impact but does not
   * hold. Held symbols are skipped — `syncTickerFromPolygon` already covers
   * them, and syncing here too would duplicate the Finnhub call.
   */
  async syncMarketWideEarnings(): Promise<void> {
    if (!(await isFinnhubConfigured())) return;

    const { marketWideSymbols } = await this.getSettings();
    if (marketWideSymbols.length === 0) return;

    const portfolio = await this.getPortfolioSymbolSet();
    const symbols = marketWideSymbols.filter((s) => !portfolio.has(s));

    for (const symbol of symbols) {
      const status = await prisma.calendarSyncStatus.findUnique({
        where: { source_symbol: { source: "finnhub", symbol } },
      });
      if (status && status.nextSyncAt > new Date()) continue;

      try {
        await this.syncEarningsForSymbol(symbol);
      } catch (err) {
        console.error(`[CalendarSync] Market-wide earnings sync failed for ${symbol}:`, err);
        continue; // Leave nextSyncAt untouched so the next cycle retries.
      }

      const now = new Date();
      await prisma.calendarSyncStatus.upsert({
        where: { source_symbol: { source: "finnhub", symbol } },
        create: {
          source: "finnhub",
          symbol,
          lastSyncAt: now,
          nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS),
        },
        update: { lastSyncAt: now, nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS) },
      });
    }
  }

  async syncOptionExpirations(): Promise<void> {
    try {
      const positions = await ibkrService.getPositions();
      const optionPositions = positions.filter(
        (p) => p.contract.secType === "OPT" && p.pos !== 0
      );

      // Remove old IBKR expiration events
      await prisma.calendarEvent.deleteMany({
        where: { source: "ibkr", eventType: "OPTION_EXPIRATION" },
      });

      // Create events for current open option positions
      for (const pos of optionPositions) {
        const expiry = pos.contract.lastTradeDateOrContractMonth;
        if (!expiry || expiry.length < 8) continue;

        const dateStr = `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}`;
        const symbol = pos.contract.symbol || "";
        const right = pos.contract.right === "P" ? "Put" : "Call";
        const strike = pos.contract.strike || 0;

        await prisma.calendarEvent.upsert({
          where: {
            source_sourceId: {
              source: "ibkr",
              sourceId: `exp:${symbol}:${strike}${pos.contract.right}:${dateStr}`,
            },
          },
          create: {
            eventType: "OPTION_EXPIRATION",
            symbol,
            date: new Date(dateStr),
            title: `${symbol} ${strike}${pos.contract.right} Expiration`,
            details: {
              strike,
              right,
              quantity: pos.pos,
              underlying: pos.contract.symbol,
            },
            source: "ibkr",
            sourceId: `exp:${symbol}:${strike}${pos.contract.right}:${dateStr}`,
          },
          update: {
            title: `${symbol} ${strike}${pos.contract.right} Expiration`,
            details: {
              strike,
              right,
              quantity: pos.pos,
              underlying: pos.contract.symbol,
            },
          },
        });
      }
    } catch (error) {
      console.error("[CalendarSync] Error syncing option expirations:", error);
    }
  }

  async syncMacroEvents(): Promise<void> {
    const currentYear = new Date().getFullYear();
    const events = getMacroEvents(currentYear);

    for (const event of events) {
      await prisma.calendarEvent.upsert({
        where: {
          source_sourceId: {
            source: "macro",
            sourceId: `${event.eventType}:${event.date}`,
          },
        },
        create: {
          eventType: event.eventType,
          symbol: null,
          date: new Date(event.date),
          title: event.title,
          details: Prisma.JsonNull,
          source: "macro",
          sourceId: `${event.eventType}:${event.date}`,
        },
        update: { title: event.title },
      });
    }
  }

  /**
   * Decide visibility and the marketWide tag for one row.
   *
   * Symbol-less events (macro, FOMC) always pass. A symbol passes when it is
   * held, or when it is a market-wide symbol on an EARNINGS row and the
   * toggle is on — the event-type check keeps stale dividend and split rows
   * for market-wide tickers hidden.
   */
  private classifyEvent(
    row: { symbol: string | null; eventType: string },
    portfolio: Set<string>,
    marketWide: Set<string>,
    includeMarketWide: boolean
  ): { visible: boolean; marketWide: boolean } {
    if (!row.symbol) return { visible: true, marketWide: false };
    if (portfolio.has(row.symbol)) return { visible: true, marketWide: false };
    const isMarketWideEarnings =
      includeMarketWide && row.eventType === "EARNINGS" && marketWide.has(row.symbol);
    return { visible: isMarketWideEarnings, marketWide: isMarketWideEarnings };
  }

  async getSettings(): Promise<CalendarSettings> {
    const [
      excludedSetting,
      spreadSetting,
      weekStartSetting,
      marketWideSetting,
      includeMarketWideSetting,
    ] = await Promise.all([
      prisma.setting.findUnique({ where: { key: "calendar.excludedEventTypes" } }),
      prisma.setting.findUnique({ where: { key: "calendar.excludeSpreadExpirations" } }),
      prisma.setting.findUnique({ where: { key: "calendar.weekStartDay" } }),
      prisma.setting.findUnique({ where: { key: "calendar.marketWideSymbols" } }),
      prisma.setting.findUnique({ where: { key: "calendar.includeMarketWideEarnings" } }),
    ]);
    return {
      excludedEventTypes: excludedSetting ? (excludedSetting.value as CalendarEventType[]) : [],
      excludeSpreadExpirations: spreadSetting ? (spreadSetting.value as boolean) : false,
      weekStartDay: weekStartSetting ? (weekStartSetting.value as CalendarSettings["weekStartDay"]) : "monday",
      // An absent row seeds the MAG7; a saved [] stays empty.
      marketWideSymbols: marketWideSetting
        ? (marketWideSetting.value as string[])
        : [...DEFAULT_MARKET_WIDE_SYMBOLS],
      includeMarketWideEarnings: includeMarketWideSetting
        ? (includeMarketWideSetting.value as boolean)
        : true,
    };
  }

  async updateSettings(settings: CalendarSettings): Promise<void> {
    await Promise.all([
      prisma.setting.upsert({
        where: { key: "calendar.excludedEventTypes" },
        create: {
          key: "calendar.excludedEventTypes",
          value: settings.excludedEventTypes as unknown as Prisma.InputJsonValue,
        },
        update: { value: settings.excludedEventTypes as unknown as Prisma.InputJsonValue },
      }),
      prisma.setting.upsert({
        where: { key: "calendar.excludeSpreadExpirations" },
        create: {
          key: "calendar.excludeSpreadExpirations",
          value: settings.excludeSpreadExpirations as unknown as Prisma.InputJsonValue,
        },
        update: { value: settings.excludeSpreadExpirations as unknown as Prisma.InputJsonValue },
      }),
      prisma.setting.upsert({
        where: { key: "calendar.weekStartDay" },
        create: {
          key: "calendar.weekStartDay",
          value: settings.weekStartDay as unknown as Prisma.InputJsonValue,
        },
        update: { value: settings.weekStartDay as unknown as Prisma.InputJsonValue },
      }),
      prisma.setting.upsert({
        where: { key: "calendar.marketWideSymbols" },
        create: {
          key: "calendar.marketWideSymbols",
          value: normalizeSymbols(settings.marketWideSymbols) as unknown as Prisma.InputJsonValue,
        },
        update: {
          value: normalizeSymbols(settings.marketWideSymbols) as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.setting.upsert({
        where: { key: "calendar.includeMarketWideEarnings" },
        create: {
          key: "calendar.includeMarketWideEarnings",
          value: settings.includeMarketWideEarnings as unknown as Prisma.InputJsonValue,
        },
        update: { value: settings.includeMarketWideEarnings as unknown as Prisma.InputJsonValue },
      }),
    ]);
  }

  private async getSpreadSymbols(): Promise<Set<string>> {
    const setting = await prisma.setting.findUnique({ where: { key: "spreads" } });
    return new Set<string>(
      (setting?.value as Record<string, unknown>)?.symbols as string[] ?? ["SPX", "XSP", "RUT"]
    );
  }

  private async getExcludedTypes(): Promise<string[]> {
    const settings = await this.getSettings();
    return settings.excludedEventTypes;
  }

  private async filterSpreadExpirations(events: CalendarEvent[]): Promise<CalendarEvent[]> {
    const settings = await this.getSettings();
    if (!settings.excludeSpreadExpirations) return events;
    const spreadSymbols = await this.getSpreadSymbols();
    return events.filter(
      (e) => !(e.eventType === "OPTION_EXPIRATION" && e.symbol && spreadSymbols.has(e.symbol))
    );
  }

  private async getPortfolioSymbolSet(): Promise<Set<string>> {
    const positions = await ibkrService.getPositions();
    return new Set(
      positions
        .filter((p) => p.contract.secType === "STK")
        .map((p) => p.contract.symbol)
        .filter(Boolean) as string[]
    );
  }

  private async getTrackedSymbols(): Promise<string[]> {
    return Array.from(await this.getPortfolioSymbolSet());
  }

  async purgeAndResync(): Promise<void> {
    console.log("[CalendarSync] Purging all events and sync status...");
    await prisma.calendarEvent.deleteMany({});
    await prisma.calendarSyncStatus.deleteMany({});
    console.log("[CalendarSync] Purge complete, starting full resync...");
    await this.syncAll();
  }

  startBackgroundSync(): void {
    // Initial sync on startup (delayed 30s to let IBKR connect)
    setTimeout(() => {
      this.syncAll().catch((err) =>
        console.error("[CalendarSync] Initial sync failed:", err)
      );
    }, 30_000);

    // Periodic sync every 6 hours
    setInterval(() => {
      this.syncAll().catch((err) =>
        console.error("[CalendarSync] Periodic sync failed:", err)
      );
    }, SYNC_INTERVAL_MS);
  }
}

export const calendarService = new CalendarService();
