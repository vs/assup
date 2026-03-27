import { describe, it, expect, vi, afterEach } from "vitest";
import { shortInterestCollector } from "../../../services/research/collectors/short-interest.collector.js";
import { ibkrService } from "../../../services/ibkr.js";
import type { SkippedCollection } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/ibkr.js", () => ({
  ibkrService: {
    isConnected: vi.fn(),
    getEnhancedMarketData: vi.fn(),
    getMarketData: vi.fn(),
  },
}));

const mockIsConnected = ibkrService.isConnected as ReturnType<typeof vi.fn>;
const mockGetEnhancedMarketData = ibkrService.getEnhancedMarketData as ReturnType<typeof vi.fn>;
const mockGetMarketData = ibkrService.getMarketData as ReturnType<typeof vi.fn>;

describe("shortInterestCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(shortInterestCollector.source).toBe("short_interest");
    expect(shortInterestCollector.defaultSchedule).toBe("0 18 1,15 * *");
  });

  it("returns SkippedCollection when IBKR not connected", async () => {
    mockIsConnected.mockReturnValue(false);
    const result = await shortInterestCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "short_interest",
    });
    expect((result as SkippedCollection).reason).toContain("IBKR not connected");
  });

  it("collects shortable data when IBKR connected", async () => {
    mockIsConnected.mockReturnValue(true);
    mockGetEnhancedMarketData.mockResolvedValue({
      contract: { symbol: "AAPL" },
      shortableShares: 5000000,
      shortableIndicator: 3.0,
    });
    mockGetMarketData.mockResolvedValue({
      contract: { symbol: "AAPL" },
      last: 180.5,
    });

    const result = await shortInterestCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("short_interest");
    const data = (result as any).data;
    expect(data.sharesAvailable).toBe(5000000);
    expect(data.shortableStatus).toBe("available");
    expect(data.shortableIndicator).toBe(3.0);
  });

  it("reports limited shortable status", async () => {
    mockIsConnected.mockReturnValue(true);
    mockGetEnhancedMarketData.mockResolvedValue({
      contract: { symbol: "ZET" },
      shortableShares: 100000,
      shortableIndicator: 2.0,
    });
    mockGetMarketData.mockResolvedValue({
      contract: { symbol: "ZET" },
      last: 25.0,
    });

    const result = await shortInterestCollector.collect("ZET");
    const data = (result as any).data;
    expect(data.shortableStatus).toBe("limited");
  });

  it("reports not_shortable status", async () => {
    mockIsConnected.mockReturnValue(true);
    mockGetEnhancedMarketData.mockResolvedValue({
      contract: { symbol: "XYZ" },
      shortableShares: 0,
      shortableIndicator: 1.0,
    });
    mockGetMarketData.mockResolvedValue({
      contract: { symbol: "XYZ" },
      last: 10.0,
    });

    const result = await shortInterestCollector.collect("XYZ");
    const data = (result as any).data;
    expect(data.shortableStatus).toBe("not_shortable");
  });

  it("returns SkippedCollection when no data available", async () => {
    mockIsConnected.mockReturnValue(true);
    mockGetEnhancedMarketData.mockResolvedValue({
      contract: { symbol: "NONE" },
      shortableShares: undefined,
      shortableIndicator: undefined,
    });
    mockGetMarketData.mockResolvedValue(null);

    const result = await shortInterestCollector.collect("NONE");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "short_interest",
    });
  });
});
