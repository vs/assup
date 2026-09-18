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
