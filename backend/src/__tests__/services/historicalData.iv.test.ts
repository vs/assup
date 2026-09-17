import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    isConnected: vi.fn(() => true),
    getHistoricalData: vi.fn(),
  },
}));

import { ibkrService } from "../../services/ibkr.js";
import { historicalDataService } from "../../services/historicalData.js";

const mockIbkr = vi.mocked(ibkrService);

describe("historicalDataService.getImpliedVolatilityHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historicalDataService.clearCache();
    mockIbkr.isConnected.mockReturnValue(true);
  });

  it("requests OPTION_IMPLIED_VOLATILITY daily bars for one year", async () => {
    mockIbkr.getHistoricalData.mockResolvedValue([
      { time: "20260808", close: 0.31 },
      { time: "20260810", close: 0.34 },
    ]);

    const bars = await historicalDataService.getImpliedVolatilityHistory("AAPL");

    expect(mockIbkr.getHistoricalData).toHaveBeenCalledTimes(1);
    const params = mockIbkr.getHistoricalData.mock.calls[0][0];
    expect(params.whatToShow).toBe("OPTION_IMPLIED_VOLATILITY");
    expect(params.duration).toBe("1 Y");
    expect(params.barSizeSetting).toBe("1 day");
    expect(bars).toEqual([
      { date: "20260808", close: 0.31 },
      { date: "20260810", close: 0.34 },
    ]);
  });

  it("does not fall back to another whatToShow when IV returns nothing", async () => {
    mockIbkr.getHistoricalData.mockResolvedValue([]);

    const bars = await historicalDataService.getImpliedVolatilityHistory("AAPL");

    expect(bars).toEqual([]);
    // Price requests retry TRADES then MIDPOINT. IV has no alternative series,
    // so exactly one request must be issued.
    expect(mockIbkr.getHistoricalData).toHaveBeenCalledTimes(1);
  });

  it("builds an IND contract for index symbols", async () => {
    mockIbkr.getHistoricalData.mockResolvedValue([{ time: "20260810", close: 0.18 }]);

    await historicalDataService.getImpliedVolatilityHistory("SPX");

    const params = mockIbkr.getHistoricalData.mock.calls[0][0];
    expect(params.contract.secType).toBe("IND");
    expect(params.contract.symbol).toBe("SPX");
  });

  it("returns an empty series when TWS is disconnected", async () => {
    mockIbkr.isConnected.mockReturnValue(false);

    const bars = await historicalDataService.getImpliedVolatilityHistory("AAPL");

    expect(bars).toEqual([]);
    expect(mockIbkr.getHistoricalData).not.toHaveBeenCalled();
  });
});
