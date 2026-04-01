import { describe, it, expect, vi, afterEach } from "vitest";
import { shortInterestCollector } from "../../../services/research/collectors/short-interest.collector.js";
import type { SkippedCollection } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/research/collectors/sa-browser.js", () => ({
  fetchSAJson: vi.fn(),
}));

import { fetchSAJson } from "../../../services/research/collectors/sa-browser.js";
const mockFetchSAJson = fetchSAJson as ReturnType<typeof vi.fn>;

describe("shortInterestCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(shortInterestCollector.source).toBe("short_interest");
    expect(shortInterestCollector.defaultSchedule).toBe("0 18 * * 1-5");
  });

  it("returns collected data with shortPercentOfSO from SA metrics", async () => {
    mockFetchSAJson.mockResolvedValue({
      data: [
        {
          attributes: { value: 0.042 },
          relationships: { metric_type: { data: { id: "mt-1" } } },
        },
      ],
      included: [
        { id: "mt-1", type: "metric_type", attributes: { field: "short_interest_shares_outstanding" } },
      ],
    });

    const result = await shortInterestCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("short_interest");
    const data = (result as any).data;
    expect(data.shortPercentOfSO).toBe(0.042);
    expect(data.symbol).toBe("AAPL");
    expect(data.daysToCover).toBe(0);
    expect(data.shortInterestTrend).toBe("unknown");
  });

  it("returns SkippedCollection when SA returns null", async () => {
    mockFetchSAJson.mockResolvedValue(null);
    const result = await shortInterestCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "short_interest",
    });
    expect((result as SkippedCollection).reason).toContain("Seeking Alpha");
  });

  it("returns SkippedCollection when metric is missing from response", async () => {
    mockFetchSAJson.mockResolvedValue({
      data: [],
      included: [],
    });
    const result = await shortInterestCollector.collect("XYZ");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "short_interest",
    });
  });

  it("passes lowercase symbol slug to SA API", async () => {
    mockFetchSAJson.mockResolvedValue(null);
    await shortInterestCollector.collect("AAPL");
    expect(mockFetchSAJson).toHaveBeenCalledWith(
      expect.stringContaining("[slugs]=aapl"),
    );
  });
});
