import { describe, it, expect, vi, beforeEach } from "vitest";

const getRate = vi.fn();

vi.mock("../../services/cnbExchangeRate.service.js", () => ({
  cnbExchangeRateService: { getRate: (...args: unknown[]) => getRate(...args) },
}));

import { convertToUsd } from "../../services/currency.js";

describe("convertToUsd", () => {
  beforeEach(() => {
    getRate.mockReset();
  });

  it("returns USD amounts untouched without hitting the rate service", async () => {
    const result = await convertToUsd(100, "USD", new Date("2026-03-02"));
    expect(result).toBe(100);
    expect(getRate).not.toHaveBeenCalled();
  });

  it("converts CZK by dividing by the USD rate", async () => {
    getRate.mockImplementation(async (_date: Date, currency: string) =>
      currency === "USD" ? 23 : null
    );
    const result = await convertToUsd(230, "CZK", new Date("2026-03-02"));
    expect(result).toBeCloseTo(10, 10);
  });

  it("converts a third currency via CZK", async () => {
    getRate.mockImplementation(async (_date: Date, currency: string) => {
      if (currency === "USD") return 23;
      if (currency === "EUR") return 25;
      return null;
    });
    const result = await convertToUsd(100, "EUR", new Date("2026-03-02"));
    expect(result).toBeCloseTo((100 * 25) / 23, 10);
  });

  it("falls back to the raw amount when no rate exists", async () => {
    getRate.mockResolvedValue(null);
    const result = await convertToUsd(50, "EUR", new Date("2026-03-02"));
    expect(result).toBe(50);
  });
});
