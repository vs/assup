import { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";
import { PolygonProvider } from "./research/providers/polygon.provider.js";
import { getMacroEvents } from "./macroCalendar.provider.js";
import { ibkrService } from "./ibkr.js";
import type { CalendarEvent, CalendarEventType, CalendarSettings } from "@assup/shared";

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const polygon = new PolygonProvider();

export class CalendarService {
  async getEvents(
    startDate: string,
    endDate: string,
    filters?: { types?: CalendarEventType[]; symbol?: string }
  ): Promise<CalendarEvent[]> {
    const excluded = await this.getExcludedTypes();
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

    return events.map((e) => ({
      id: e.id,
      eventType: e.eventType as CalendarEventType,
      symbol: e.symbol,
      date: e.date.toISOString().split("T")[0],
      title: e.title,
      details: e.details as Record<string, unknown> | null,
      source: e.source,
      sourceId: e.sourceId,
    }));
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

    return events.map((e) => ({
      id: e.id,
      eventType: e.eventType as CalendarEventType,
      symbol: e.symbol,
      date: e.date.toISOString().split("T")[0],
      title: e.title,
      details: e.details as Record<string, unknown> | null,
      source: e.source,
      sourceId: e.sourceId,
    }));
  }

  async getTodayAndUpcoming(days = 5): Promise<CalendarEvent[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    return this.getEvents(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0]
    );
  }

  async syncAll(): Promise<void> {
    console.log("[CalendarSync] Starting full sync...");
    const symbols = await this.getTrackedSymbols();
    console.log(`[CalendarSync] Syncing ${symbols.length} symbols`);

    // Sync macro events (fast, no rate limits)
    await this.syncMacroEvents();

    // Sync IBKR option expirations
    await this.syncOptionExpirations();

    // Sync Polygon data per ticker (rate limited)
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
      // Fetch earnings
      const earnings = await polygon.getEarningsCalendar(symbol);
      for (const e of earnings) {
        if (!e.date) continue;
        await prisma.calendarEvent.upsert({
          where: { source_sourceId: { source: "polygon", sourceId: `earnings:${symbol}:${e.date}` } },
          create: {
            eventType: "EARNINGS",
            symbol,
            date: new Date(e.date),
            title: `${symbol} ${e.quarter} Earnings`,
            details: { estimateEps: e.estimateEps, actualEps: e.actualEps, quarter: e.quarter },
            source: "polygon",
            sourceId: `earnings:${symbol}:${e.date}`,
          },
          update: {
            title: `${symbol} ${e.quarter} Earnings`,
            details: { estimateEps: e.estimateEps, actualEps: e.actualEps, quarter: e.quarter },
          },
        });
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

  async getSettings(): Promise<CalendarSettings> {
    const setting = await prisma.setting.findUnique({
      where: { key: "calendar.excludedEventTypes" },
    });
    return {
      excludedEventTypes: setting ? (setting.value as CalendarEventType[]) : [],
    };
  }

  async updateSettings(settings: CalendarSettings): Promise<void> {
    await prisma.setting.upsert({
      where: { key: "calendar.excludedEventTypes" },
      create: {
        key: "calendar.excludedEventTypes",
        value: JSON.stringify(settings.excludedEventTypes),
      },
      update: { value: JSON.stringify(settings.excludedEventTypes) },
    });
  }

  private async getExcludedTypes(): Promise<string[]> {
    const settings = await this.getSettings();
    return settings.excludedEventTypes;
  }

  private async getTrackedSymbols(): Promise<string[]> {
    // Get symbols from IBKR positions (stock positions only, options tracked separately)
    const positions = await ibkrService.getPositions();
    const positionSymbols = new Set(
      positions
        .filter((p) => p.contract.secType === "STK")
        .map((p) => p.contract.symbol)
        .filter(Boolean) as string[]
    );

    // Get symbols from watchlists
    const watchlistItems = await prisma.watchlistItem.findMany({
      select: { symbol: true },
    });
    for (const item of watchlistItems) {
      positionSymbols.add(item.symbol);
    }

    return Array.from(positionSymbols);
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
