import { describe, it, expect, vi, beforeEach } from "vitest";

const polygonLanes = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("../../db/index.js", () => ({
  prisma: {
    setting: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    calendarEvent: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    calendarSyncStatus: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("../../services/ibkr.js", () => ({ ibkrService: { getPositions: vi.fn() } }));

vi.mock("../../services/finnhub.client.js", () => ({
  fetchFinnhubEarnings: vi.fn(),
  isFinnhubConfigured: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../services/research/providers/polygon.provider.js", () => ({
  PolygonProvider: class {
    constructor(private opts: { priority?: string } = {}) {}
    async getDividendCalendar() {
      polygonLanes.calls.push(`${this.opts.priority ?? "interactive"}:dividends`);
      return [];
    }
    async getStockSplits() {
      polygonLanes.calls.push(`${this.opts.priority ?? "interactive"}:splits`);
      return [];
    }
  },
}));

import { calendarService } from "../../services/calendar.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  polygonLanes.calls.length = 0;
});

describe("calendar sync lane", () => {
  it("syncs dividends and splits on the background lane", async () => {
    await calendarService.syncTickerFromPolygon("QZHI");

    expect(polygonLanes.calls).toEqual(["background:dividends", "background:splits"]);
  });
});
