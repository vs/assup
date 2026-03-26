import { describe, it, expect } from "vitest";
import { eventsAnalyzer } from "../../../services/research/analyzers/events.analyzer.js";

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().split("T")[0];
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

describe("eventsAnalyzer", () => {
  it("returns neutral for empty data", async () => {
    const result = await eventsAnalyzer.analyze({ earnings: [], dividends: [] });
    expect(result.signal).toBe("neutral");
    expect(result.summary).toContain("No significant events");
  });

  it("returns neutral for null data", async () => {
    const result = await eventsAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
  });

  it("detects earnings beat pattern", async () => {
    const earnings = [
      { symbol: "AAPL", date: daysAgo(90), estimateEps: 1.0, actualEps: 1.5, quarter: "Q1 2025" },
      { symbol: "AAPL", date: daysAgo(180), estimateEps: 1.0, actualEps: 1.3, quarter: "Q4 2024" },
      { symbol: "AAPL", date: daysAgo(270), estimateEps: 1.0, actualEps: 1.2, quarter: "Q3 2024" },
    ];
    const result = await eventsAnalyzer.analyze({ earnings, dividends: [] });
    expect(result.summary).toContain("beat");
    expect((result.details as Record<string, unknown>).earningsBeatRate).toBe(1);
  });

  it("detects earnings miss pattern", async () => {
    const earnings = [
      { symbol: "AAPL", date: daysAgo(90), estimateEps: 1.5, actualEps: 1.0, quarter: "Q1 2025" },
      { symbol: "AAPL", date: daysAgo(180), estimateEps: 1.5, actualEps: 1.0, quarter: "Q4 2024" },
    ];
    const result = await eventsAnalyzer.analyze({ earnings, dividends: [] });
    expect(result.summary).toContain("miss");
  });

  it("detects upcoming earnings catalyst (< 30 days)", async () => {
    const earnings = [
      { symbol: "AAPL", date: daysFromNow(15), estimateEps: 1.5, actualEps: null, quarter: "Q2 2026" },
    ];
    const result = await eventsAnalyzer.analyze({ earnings, dividends: [] });
    expect(result.summary).toContain("catalyst");
  });

  it("classifies dividend growth", async () => {
    const dividends = [
      { symbol: "AAPL", exDate: daysAgo(30), payDate: null, amount: 1.10, frequency: "quarterly" },
      { symbol: "AAPL", exDate: daysAgo(120), payDate: null, amount: 1.05, frequency: "quarterly" },
      { symbol: "AAPL", exDate: daysAgo(210), payDate: null, amount: 1.00, frequency: "quarterly" },
      { symbol: "AAPL", exDate: daysAgo(300), payDate: null, amount: 0.95, frequency: "quarterly" },
    ];
    const result = await eventsAnalyzer.analyze({ earnings: [], dividends });
    expect((result.details as Record<string, unknown>).dividendGrowth).toBe("growing");
  });

  it("classifies declining dividends", async () => {
    const dividends = [
      { symbol: "AAPL", exDate: daysAgo(30), payDate: null, amount: 0.80, frequency: "quarterly" },
      { symbol: "AAPL", exDate: daysAgo(120), payDate: null, amount: 0.90, frequency: "quarterly" },
      { symbol: "AAPL", exDate: daysAgo(210), payDate: null, amount: 1.00, frequency: "quarterly" },
      { symbol: "AAPL", exDate: daysAgo(300), payDate: null, amount: 1.10, frequency: "quarterly" },
    ];
    const result = await eventsAnalyzer.analyze({ earnings: [], dividends });
    expect((result.details as Record<string, unknown>).dividendGrowth).toBe("declining");
  });

  it("uses ±0.005 threshold for beat/miss", async () => {
    const earnings = [
      { symbol: "AAPL", date: daysAgo(90), estimateEps: 1.0, actualEps: 1.004, quarter: "Q1" },
    ];
    const result = await eventsAnalyzer.analyze({ earnings, dividends: [] });
    const surprises = (result.details as Record<string, unknown>).recentEarningsSurprises as Array<Record<string, unknown>>;
    expect(surprises[0].surprise).toBe("meet");
  });
});
