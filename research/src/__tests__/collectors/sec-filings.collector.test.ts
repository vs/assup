import { describe, it, expect, vi, afterEach } from "vitest";
import { secFilingsCollector } from "../../collectors/sec-filings.collector.js";
import { mockFetchResponse, mockFetchError } from "../helpers/mock-fetch.js";

describe("secFilingsCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(secFilingsCollector.source).toBe("sec_filings");
    expect(secFilingsCollector.stalenessMinutes).toBe(1440);
  });

  it("collects and counts filings", async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000).toISOString().split("T")[0];
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString().split("T")[0];

    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      hits: {
        hits: [
          { _id: "1", _source: { file_date: tenDaysAgo, form_type: "4", entity_name: "CEO", file_num: "001" } },
          { _id: "2", _source: { file_date: sixtyDaysAgo, form_type: "4", entity_name: "CFO", file_num: "002" } },
        ],
        total: { value: 2 },
      },
    }));

    const result = await secFilingsCollector.collect("AAPL");
    expect(result.source).toBe("sec_filings");
    expect(result.data.filingCount90d).toBe(2);
    expect(result.data.filingCount30d).toBe(1);
    expect((result.data.recentFilings as unknown[]).length).toBe(2);
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchError(500, "Server Error"));
    await expect(secFilingsCollector.collect("AAPL")).rejects.toThrow("500");
  });

  it("handles empty results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      hits: { hits: [], total: { value: 0 } },
    }));

    const result = await secFilingsCollector.collect("AAPL");
    expect(result.data.filingCount90d).toBe(0);
    expect(result.data.filingCount30d).toBe(0);
  });

  it("filters out hits with null _source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetchResponse({
      hits: {
        hits: [
          { _id: "1", _source: null },
          { _id: "2", _source: { file_date: "2026-02-01", form_type: "4", entity_name: "CEO", file_num: "001" } },
        ],
        total: { value: 2 },
      },
    }));

    const result = await secFilingsCollector.collect("AAPL");
    expect(result.data.filingCount90d).toBe(1);
  });
});
