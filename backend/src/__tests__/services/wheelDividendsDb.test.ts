import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
const aggregate = vi.fn();

vi.mock("../../db/index.js", () => ({
  prisma: {
    cashTransaction: {
      findMany: (...args: unknown[]) => findMany(...args),
      aggregate: (...args: unknown[]) => aggregate(...args),
    },
  },
}));

vi.mock("../../services/currency.js", () => ({
  convertToUsd: vi.fn(async (amount: number, currency: string) =>
    currency === "USD" ? amount : amount * 2
  ),
}));

import {
  fetchDividendCashRows,
  fetchDividendCashRowsForSymbols,
  getDividendStats,
} from "../../services/wheelDividends.js";

describe("fetchDividendCashRows", () => {
  beforeEach(() => {
    findMany.mockReset();
    aggregate.mockReset();
  });

  it("filters by symbol, dividend types and start date, and converts to USD", async () => {
    findMany.mockResolvedValue([
      {
        symbol: "TLT",
        type: "DIVIDEND",
        transactionDate: new Date("2026-08-06T00:00:00.000Z"),
        description: "TLT CASH DIVIDEND USD 0.33 PER SHARE",
        amount: 10,
        currency: "EUR",
      },
    ]);

    const rows = await fetchDividendCashRows("TLT", new Date("2026-01-01T00:00:00.000Z"));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          symbol: "TLT",
          type: { in: ["DIVIDEND", "WITHHOLDING_TAX"] },
          transactionDate: { gte: new Date("2026-01-01T00:00:00.000Z") },
        }),
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amountUsd).toBe(20);
    expect(rows[0].type).toBe("DIVIDEND");
  });

  it("omits the date filter when the tracker has no start date", async () => {
    findMany.mockResolvedValue([]);
    await fetchDividendCashRows("TLT", null);
    const where = findMany.mock.calls[0][0].where;
    expect(where.transactionDate).toBeUndefined();
  });

  it("groups rows by symbol for the batch path", async () => {
    findMany.mockResolvedValue([
      { symbol: "TLT", type: "DIVIDEND", transactionDate: new Date("2026-08-06"), description: "d", amount: 1, currency: "USD" },
      { symbol: "QZKU", type: "DIVIDEND", transactionDate: new Date("2026-06-30"), description: "d", amount: 2, currency: "USD" },
      { symbol: "TLT", type: "WITHHOLDING_TAX", transactionDate: new Date("2026-08-06"), description: "d", amount: -1, currency: "USD" },
    ]);

    const bySymbol = await fetchDividendCashRowsForSymbols(["TLT", "QZKU"]);

    expect(bySymbol.get("TLT")).toHaveLength(2);
    expect(bySymbol.get("QZKU")).toHaveLength(1);
  });
});

describe("getDividendStats", () => {
  beforeEach(() => {
    findMany.mockReset();
    aggregate.mockReset();
  });

  it("returns the count and latest date used for cache validation", async () => {
    aggregate.mockResolvedValue({
      _count: { _all: 7 },
      _max: { transactionDate: new Date("2026-08-06T00:00:00.000Z") },
    });

    const stats = await getDividendStats("TLT", null);

    expect(stats).toEqual({
      dividendCount: 7,
      lastDividendDate: new Date("2026-08-06T00:00:00.000Z"),
    });
  });
});
