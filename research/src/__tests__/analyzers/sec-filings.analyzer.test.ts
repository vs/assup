import { describe, it, expect } from "vitest";
import { secFilingsAnalyzer } from "../../analyzers/sec-filings.analyzer.js";

describe("secFilingsAnalyzer", () => {
  it("returns neutral with low confidence for zero filings", async () => {
    const result = await secFilingsAnalyzer.analyze({
      filingCount30d: 0, filingCount90d: 0, recentFilings: [],
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
    expect(result.summary).toContain("No Form 4");
  });

  it("returns neutral with 0.3 confidence for high activity", async () => {
    const result = await secFilingsAnalyzer.analyze({
      filingCount30d: 5, filingCount90d: 12, recentFilings: [],
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.3);
    expect(result.summary).toContain("High insider activity");
  });

  it("returns neutral with 0.2 confidence for moderate activity", async () => {
    const result = await secFilingsAnalyzer.analyze({
      filingCount30d: 2, filingCount90d: 5, recentFilings: [],
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.2);
    expect(result.summary).toContain("Moderate");
  });

  it("returns neutral with 0.1 confidence for low activity", async () => {
    const result = await secFilingsAnalyzer.analyze({
      filingCount30d: 1, filingCount90d: 2, recentFilings: [],
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
  });

  it("caps recentFilings in details to 10", async () => {
    const filings = Array.from({ length: 15 }, (_, i) => ({
      id: `id-${i}`, fileDate: "2026-01-01", formType: "4",
      entityName: "CEO", periodOfReport: null,
    }));
    const result = await secFilingsAnalyzer.analyze({
      filingCount30d: 5, filingCount90d: 15, recentFilings: filings,
    });
    const details = result.details as Record<string, unknown>;
    expect((details.recentFilings as unknown[]).length).toBe(10);
  });

  it("always returns neutral signal regardless of count", async () => {
    const result = await secFilingsAnalyzer.analyze({
      filingCount30d: 100, filingCount90d: 500, recentFilings: [],
    });
    expect(result.signal).toBe("neutral");
  });
});
