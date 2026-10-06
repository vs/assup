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
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([]);
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
    // The session is rendered from details.hour, so the title stays clean.
    expect(call.create.title).toBe("AAPL Q4 2026 Earnings");
    expect(call.update.title).toBe("AAPL Q4 2026 Earnings");
    expect(call.create.details.hour).toBe("amc");
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

/** Build a Finnhub earnings entry for AAPL. */
function finnhubEarnings(date: string, quarter: number, year: number) {
  return {
    date,
    epsActual: null,
    epsEstimate: 2.35,
    hour: "amc" as const,
    quarter,
    revenueActual: null,
    revenueEstimate: 1e11,
    symbol: "AAPL",
    year,
  };
}

describe("CalendarService earnings date changes", () => {
  /** Rows already stored for AAPL: Q4 under two dates, plus the previous quarter. */
  const storedRows = [
    { id: "q4-old", sourceId: "earnings:AAPL:2026-10-28", details: { quarter: "Q4 2026" } },
    { id: "q4-new", sourceId: "earnings:AAPL:2026-10-29", details: { quarter: "Q4 2026" } },
    { id: "q3", sourceId: "earnings:AAPL:2026-07-30", details: { quarter: "Q3 2026" } },
  ];

  beforeEach(() => {
    vi.mocked(isFinnhubConfigured).mockResolvedValue(true);
    vi.mocked(prisma.calendarEvent.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.calendarEvent.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.calendarSyncStatus.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.calendarSyncStatus.findUnique).mockResolvedValue(null);
    vi.mocked(ibkrService.getPositions).mockResolvedValue([] as any);
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
  });

  it("removes the row left under a quarter's previous announcement date", async () => {
    vi.mocked(fetchFinnhubEarnings).mockResolvedValue([finnhubEarnings("2026-10-29", 4, 2026)]);
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue(storedRows as any);

    await calendarService.syncMarketWideEarnings();

    // Only this symbol's Finnhub earnings are candidates for removal.
    expect(vi.mocked(prisma.calendarEvent.findMany).mock.calls[0][0]?.where).toEqual({
      source: "finnhub",
      eventType: "EARNINGS",
      symbol: "AAPL",
    });
    // The current date and the quarter Finnhub did not return both survive.
    expect(prisma.calendarEvent.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.calendarEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["q4-old"] } },
    });
  });

  it("deletes nothing when the announcement date is unchanged", async () => {
    vi.mocked(fetchFinnhubEarnings).mockResolvedValue([finnhubEarnings("2026-10-29", 4, 2026)]);
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([storedRows[1], storedRows[2]] as any);

    await calendarService.syncMarketWideEarnings();

    expect(prisma.calendarEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes nothing when Finnhub returns no earnings", async () => {
    vi.mocked(fetchFinnhubEarnings).mockResolvedValue([]);
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue(storedRows as any);

    await calendarService.syncMarketWideEarnings();

    expect(prisma.calendarEvent.deleteMany).not.toHaveBeenCalled();
  });
});

/** Build a Prisma calendar_event row. */
function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    eventType: "EARNINGS",
    symbol: "AAPL",
    date: new Date("2026-10-30T00:00:00Z"),
    title: "AAPL Q4 2026 Earnings",
    details: null,
    source: "finnhub",
    sourceId: "earnings:AAPL:2026-10-30",
    ...overrides,
  };
}

describe("CalendarService.getEvents market-wide filtering", () => {
  beforeEach(() => {
    vi.mocked(ibkrService.getPositions).mockResolvedValue([stockPosition("NVDA")] as any);
  });

  it("includes earnings for a market-wide symbol the user does not hold", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([eventRow()] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events).toHaveLength(1);
    expect(events[0].symbol).toBe("AAPL");
  });

  it("tags an unheld market-wide symbol as marketWide", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([eventRow()] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events[0].marketWide).toBe(true);
  });

  it("does not tag a held symbol as marketWide even when it is on the list", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL", "NVDA"] });
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      eventRow({ symbol: "NVDA", sourceId: "earnings:NVDA:2026-10-30" }),
    ] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events[0].marketWide).toBe(false);
  });

  it("hides market-wide earnings when the toggle is off", async () => {
    stubSettings({
      "calendar.marketWideSymbols": ["AAPL"],
      "calendar.includeMarketWideEarnings": false,
    });
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([eventRow()] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events).toEqual([]);
  });

  it("hides non-earnings events for a market-wide symbol", async () => {
    stubSettings({ "calendar.marketWideSymbols": ["AAPL"] });
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      eventRow({
        eventType: "DIVIDEND_EX_DATE",
        source: "polygon",
        sourceId: "div_ex:AAPL:2026-10-30",
      }),
    ] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events).toEqual([]);
  });

  it("still returns events with no symbol", async () => {
    stubSettings({});
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      eventRow({ eventType: "FOMC", symbol: null, title: "FOMC Meeting", source: "macro" }),
    ] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events).toHaveLength(1);
    expect(events[0].marketWide).toBe(false);
  });

  it("still returns events for held symbols that are not on the list", async () => {
    stubSettings({ "calendar.marketWideSymbols": [] });
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      eventRow({ symbol: "NVDA", sourceId: "earnings:NVDA:2026-10-30" }),
    ] as any);

    const events = await calendarService.getEvents("2026-10-01", "2026-10-31");
    expect(events).toHaveLength(1);
    expect(events[0].marketWide).toBe(false);
  });
});
