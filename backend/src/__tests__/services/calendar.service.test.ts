import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma - must be before the service import
vi.mock("../../db/index.js", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    calendarEvent: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    calendarSyncStatus: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: { getPositions: vi.fn() },
}));

vi.mock("../../services/finnhub.client.js", () => ({
  fetchFinnhubEarnings: vi.fn(),
  isFinnhubConfigured: vi.fn(),
}));

vi.mock("../../services/research/providers/polygon.provider.js", () => ({
  PolygonProvider: class {
    async getDividendCalendar() { return []; }
    async getStockSplits() { return []; }
  },
}));

import { prisma } from "../../db/index.js";
import { calendarService } from "../../services/calendar.service.js";
import { DEFAULT_MARKET_WIDE_SYMBOLS } from "@assup/shared";

/** Route setting.findUnique by key using a plain record of stored values. */
function stubSettings(stored: Record<string, unknown>) {
  vi.mocked(prisma.setting.findUnique).mockImplementation(((args: any) => {
    const key = args.where.key as string;
    return Promise.resolve(
      key in stored ? ({ key, value: stored[key] } as any) : null
    );
  }) as any);
}

describe("CalendarService settings", () => {
  beforeEach(() => {
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as any);
  });

  it("seeds the MAG7 when the symbol setting row is absent", async () => {
    stubSettings({});
    const settings = await calendarService.getSettings();
    expect(settings.marketWideSymbols).toEqual([...DEFAULT_MARKET_WIDE_SYMBOLS]);
  });

  it("keeps an explicitly saved empty list empty instead of re-seeding", async () => {
    stubSettings({ "calendar.marketWideSymbols": [] });
    const settings = await calendarService.getSettings();
    expect(settings.marketWideSymbols).toEqual([]);
  });

  it("returns the saved symbol list when present", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["JPM", "AVGO"] });
    const settings = await calendarService.getSettings();
    expect(settings.marketWideSymbols).toEqual(["JPM", "AVGO"]);
  });

  it("defaults includeMarketWideEarnings to true when absent", async () => {
    stubSettings({});
    const settings = await calendarService.getSettings();
    expect(settings.includeMarketWideEarnings).toBe(true);
  });

  it("respects includeMarketWideEarnings when saved as false", async () => {
    stubSettings({ "calendar.includeMarketWideEarnings": false });
    const settings = await calendarService.getSettings();
    expect(settings.includeMarketWideEarnings).toBe(false);
  });

  it("uppercases, trims and de-duplicates symbols on save", async () => {
    stubSettings({});
    await calendarService.updateSettings({
      excludedEventTypes: [],
      excludeSpreadExpirations: false,
      weekStartDay: "monday",
      marketWideSymbols: [" aapl ", "AAPL", "msft"],
      includeMarketWideEarnings: true,
    });

    const call = vi
      .mocked(prisma.setting.upsert)
      .mock.calls.find((c: any) => c[0].where.key === "calendar.marketWideSymbols");
    expect(call).toBeDefined();
    expect((call as any)[0].create.value).toEqual(["AAPL", "MSFT"]);
  });
});

import { fetchFinnhubEarnings, isFinnhubConfigured } from "../../services/finnhub.client.js";
import { ibkrService } from "../../services/ibkr.js";

/** Build an IBKR stock position for the portfolio-set helper. */
function stockPosition(symbol: string) {
  return { contract: { secType: "STK", symbol }, pos: 100 };
}

describe("CalendarService.syncMarketWideEarnings", () => {
  beforeEach(() => {
    vi.mocked(isFinnhubConfigured).mockResolvedValue(true);
    vi.mocked(prisma.setting.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.calendarEvent.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.calendarSyncStatus.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.calendarSyncStatus.findUnique).mockResolvedValue(null);
    vi.mocked(fetchFinnhubEarnings).mockResolvedValue([]);
  });

  it("skips symbols already held in the portfolio", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL", "NVDA"] });
    vi.mocked(ibkrService.getPositions).mockResolvedValue([stockPosition("NVDA")] as any);

    await calendarService.syncMarketWideEarnings();

    const fetched = vi.mocked(fetchFinnhubEarnings).mock.calls.map((c) => c[0]);
    expect(fetched).toEqual(["AAPL"]);
  });

  it("upserts earnings under the shared finnhub source key", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
    vi.mocked(ibkrService.getPositions).mockResolvedValue([] as any);
    vi.mocked(fetchFinnhubEarnings).mockResolvedValue([
      {
        date: "2026-10-30",
        epsActual: null,
        epsEstimate: 2.35,
        hour: "amc",
        quarter: 4,
        revenueActual: null,
        revenueEstimate: 1e11,
        symbol: "AAPL",
        year: 2026,
      },
    ]);

    await calendarService.syncMarketWideEarnings();

    const call = vi.mocked(prisma.calendarEvent.upsert).mock.calls[0][0] as any;
    expect(call.where.source_sourceId).toEqual({
      source: "finnhub",
      sourceId: "earnings:AAPL:2026-10-30",
    });
    expect(call.create.eventType).toBe("EARNINGS");
    expect(call.create.title).toBe("AAPL Q4 2026 Earnings (After Close)");
  });

  it("does nothing when Finnhub is not configured", async () => {
    vi.mocked(isFinnhubConfigured).mockResolvedValue(false);
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
    vi.mocked(ibkrService.getPositions).mockResolvedValue([] as any);

    await calendarService.syncMarketWideEarnings();

    expect(fetchFinnhubEarnings).not.toHaveBeenCalled();
  });

  it("does not re-fetch a symbol whose sync is not yet due", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
    vi.mocked(ibkrService.getPositions).mockResolvedValue([] as any);
    vi.mocked(prisma.calendarSyncStatus.findUnique).mockResolvedValue({
      nextSyncAt: new Date(Date.now() + 60 * 60 * 1000),
    } as any);

    await calendarService.syncMarketWideEarnings();

    expect(fetchFinnhubEarnings).not.toHaveBeenCalled();
  });
});
