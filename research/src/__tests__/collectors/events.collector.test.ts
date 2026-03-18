import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventsCollector } from "../../collectors/events.collector.js";

vi.mock("../../providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

import { getMarketDataProvider } from "../../providers/index.js";

describe("eventsCollector", () => {
  const mockProvider = {
    name: "mock",
    getEarningsCalendar: vi.fn(),
    getDividendCalendar: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getMarketDataProvider).mockReturnValue(mockProvider as any);
  });

  it("has correct source and schedule", () => {
    expect(eventsCollector.source).toBe("events");
    expect(eventsCollector.stalenessMinutes).toBe(720);
  });

  it("collects both earnings and dividends", async () => {
    const earnings = [{ symbol: "AAPL", date: "2026-04-01", estimateEps: 1.5, actualEps: null, quarter: "Q2 2026" }];
    const dividends = [{ symbol: "AAPL", exDate: "2026-03-15", payDate: null, amount: 0.25, frequency: "quarterly" }];
    mockProvider.getEarningsCalendar.mockResolvedValue(earnings);
    mockProvider.getDividendCalendar.mockResolvedValue(dividends);

    const result = await eventsCollector.collect("AAPL");
    expect(result.source).toBe("events");
    expect(result.data.earnings).toEqual(earnings);
    expect(result.data.dividends).toEqual(dividends);
  });

  it("succeeds when only earnings available (dividends fail)", async () => {
    mockProvider.getEarningsCalendar.mockResolvedValue([]);
    mockProvider.getDividendCalendar.mockRejectedValue(new Error("fail"));

    const result = await eventsCollector.collect("AAPL");
    expect(result.data.earnings).toEqual([]);
    expect(result.data.dividends).toBeNull();
  });

  it("succeeds when only dividends available (earnings fail)", async () => {
    mockProvider.getEarningsCalendar.mockRejectedValue(new Error("fail"));
    mockProvider.getDividendCalendar.mockResolvedValue([]);

    const result = await eventsCollector.collect("AAPL");
    expect(result.data.earnings).toBeNull();
    expect(result.data.dividends).toEqual([]);
  });

  it("throws when both earnings and dividends fail", async () => {
    mockProvider.getEarningsCalendar.mockRejectedValue(new Error("earnings fail"));
    mockProvider.getDividendCalendar.mockRejectedValue(new Error("dividends fail"));

    await expect(eventsCollector.collect("AAPL")).rejects.toThrow("Failed to fetch both");
  });
});
