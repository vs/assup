/**
 * Tax calculation integration tests.
 *
 * Uses a real Postgres test database (assup_test). Each test seeds the
 * tables it cares about via prisma and then asserts on
 * taxCalculationService output.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../../db/index.js";
import { taxCalculationService } from "../../services/taxCalculation.service.js";

async function cleanDb() {
  await prisma.cashTransaction.deleteMany({});
  await prisma.dividendReportRecord.deleteMany({});
  await prisma.dividendReportUpload.deleteMany({});
  await prisma.importedTrade.deleteMany({});
  await prisma.importBatch.deleteMany({});
  await prisma.exchangeRate.deleteMany({ where: { date: { gte: new Date("2025-01-01") } } });
}

async function seedImportBatch() {
  return prisma.importBatch.create({
    data: {
      filename: "test.csv",
      periodStart: new Date("2025-01-01"),
      periodEnd: new Date("2025-12-31"),
      recordCount: 0,
      fileHash: `test-${Math.random()}`,
    },
  });
}

async function seedRate(date: string, rate = 23.0) {
  await prisma.exchangeRate.upsert({
    where: { date_currency: { date: new Date(date), currency: "USD" } },
    create: { date: new Date(date), currency: "USD", rate, source: "TEST" },
    update: { rate },
  });
}

describe("taxCalculationService.getInterest with WHT reversal", () => {
  beforeEach(cleanDb);

  it("nets broker-interest WHT and its CANCEL to zero", async () => {
    const batch = await seedImportBatch();
    await seedRate("2025-01-06");
    await seedRate("2025-02-05");
    await seedRate("2025-02-20");

    await prisma.cashTransaction.createMany({
      data: [
        {
          importBatchId: batch.id,
          transactionId: "i1",
          symbol: null,
          description: "USD CREDIT INT FOR DEC-2024",
          transactionDate: new Date("2025-01-06"),
          amount: 815.4,
          currency: "USD",
          type: "INTEREST",
        },
        {
          importBatchId: batch.id,
          transactionId: "w1",
          symbol: null,
          description: "WITHHOLDING @ 20% ON CREDIT INT FOR DEC-2024",
          transactionDate: new Date("2025-01-06"),
          amount: -163.08,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
        {
          importBatchId: batch.id,
          transactionId: "w1c",
          symbol: null,
          description: "CANCEL WITHHOLDING ON CREDIT INT FOR DEC-2024",
          transactionDate: new Date("2025-02-20"),
          amount: 163.08,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
      ],
    });

    const result = await taxCalculationService.getInterest(2025);
    // One interest row (the 815.4 receipt).
    expect(result.interest.length).toBe(1);
    expect(result.interest[0].amountUsd).toBeCloseTo(815.4, 2);
    expect(result.total).toBeCloseTo(815.4 * 23.0, 2);
    expect(result.unpairedReversals).toEqual([]);
  });

  it("includes Dividend Report INTEREST records (e.g., TLT reclassification)", async () => {
    const batch = await seedImportBatch();
    await seedRate("2025-12-04");
    await seedRate("2025-12-24");

    const upload = await prisma.dividendReportUpload.create({
      data: {
        filename: "dr-2025.csv",
        fileHash: "h1",
        taxYear: 2025,
        recordCount: 2,
      },
    });
    await prisma.dividendReportRecord.createMany({
      data: [
        {
          uploadId: upload.id,
          symbol: "TLT",
          payDate: new Date("2025-12-04"),
          revenueComponent: "Interest from RIC or REIT",
          taxCategory: "INTEREST",
          currency: "USD",
          grossUsd: 32.06,
          withholdUsd: 0,
        },
        {
          uploadId: upload.id,
          symbol: "TLT",
          payDate: new Date("2025-12-24"),
          revenueComponent: "Interest from RIC or REIT",
          taxCategory: "INTEREST",
          currency: "USD",
          grossUsd: 68.49,
          withholdUsd: 0,
        },
      ],
    });

    const result = await taxCalculationService.getInterest(2025);
    expect(result.interest.length).toBe(2);
    expect(result.interest.every((r) => r.source === "dividend-report")).toBe(true);
    expect(result.interest.every((r) => r.fromSecurity)).toBe(true);
    expect(result.total).toBeCloseTo((32.06 + 68.49) * 23.0, 2);
  });
});

describe("taxCalculationService.getDividends with Dividend Report override", () => {
  beforeEach(cleanDb);

  it("TLT FLEX dividend is replaced by Dividend Report INTEREST classification", async () => {
    const batch = await seedImportBatch();
    await seedRate("2025-12-04");
    await seedRate("2025-12-24");

    // FLEX shows TLT as Dividends with WHT.
    await prisma.cashTransaction.createMany({
      data: [
        {
          importBatchId: batch.id,
          transactionId: "tlt-div-1",
          symbol: "TLT",
          description: "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE (Ordinary Dividend)",
          transactionDate: new Date("2025-12-04"),
          amount: 32.06,
          currency: "USD",
          type: "DIVIDEND",
        },
        {
          importBatchId: batch.id,
          transactionId: "tlt-wht-1",
          symbol: "TLT",
          description: "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE - US TAX",
          transactionDate: new Date("2025-12-04"),
          amount: -4.81,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
        {
          importBatchId: batch.id,
          transactionId: "tlt-div-2",
          symbol: "TLT",
          description: "TLT(USZ958700214) CASH DIVIDEND USD 0.342437 PER SHARE (Ordinary Dividend)",
          transactionDate: new Date("2025-12-24"),
          amount: 68.49,
          currency: "USD",
          type: "DIVIDEND",
        },
        {
          importBatchId: batch.id,
          transactionId: "tlt-wht-2",
          symbol: "TLT",
          description: "TLT(USZ958700214) CASH DIVIDEND USD 0.342437 PER SHARE - US TAX",
          transactionDate: new Date("2025-12-24"),
          amount: -10.27,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
      ],
    });

    // Dividend Report says it's INTEREST with 0 WHT.
    const upload = await prisma.dividendReportUpload.create({
      data: { filename: "dr.csv", fileHash: "h", taxYear: 2025, recordCount: 2 },
    });
    await prisma.dividendReportRecord.createMany({
      data: [
        {
          uploadId: upload.id,
          symbol: "TLT",
          payDate: new Date("2025-12-04"),
          revenueComponent: "Interest from RIC or REIT",
          taxCategory: "INTEREST",
          currency: "USD",
          grossUsd: 32.06,
          withholdUsd: 0,
        },
        {
          uploadId: upload.id,
          symbol: "TLT",
          payDate: new Date("2025-12-24"),
          revenueComponent: "Interest from RIC or REIT",
          taxCategory: "INTEREST",
          currency: "USD",
          grossUsd: 68.49,
          withholdUsd: 0,
        },
      ],
    });

    const result = await taxCalculationService.getDividends(2025);
    // TLT should be GONE from the dividends bucket (it's interest now).
    expect(result.dividends.find((d) => d.symbol === "TLT")).toBeUndefined();
    expect(result.totals.gross).toBe(0);
    expect(result.totals.withholdingTax).toBe(0);

    // And present in the interest bucket.
    const interest = await taxCalculationService.getInterest(2025);
    expect(interest.interest.filter((i) => i.fromSecurity && i.symbol === "TLT").length).toBe(2);
  });

  it("partial split: QZDO contributes to both DIVIDEND and INTEREST buckets", async () => {
    const batch = await seedImportBatch();
    await seedRate("2026-01-15");
    // Pay-date in 2026 — FLEX would land in 2026 too. Test against 2026.
    await prisma.cashTransaction.createMany({
      data: [
        {
          importBatchId: batch.id,
          transactionId: "qzdo-div",
          symbol: "QZDO",
          description: "QZDO CASH DIVIDEND USD 0.37 PER SHARE (Ordinary Dividend)",
          transactionDate: new Date("2026-01-15"),
          amount: 111,
          currency: "USD",
          type: "DIVIDEND",
        },
        {
          importBatchId: batch.id,
          transactionId: "qzdo-wht",
          symbol: "QZDO",
          description: "QZDO CASH DIVIDEND USD 0.37 PER SHARE - US TAX",
          transactionDate: new Date("2026-01-15"),
          amount: -1.52,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
      ],
    });
    const upload = await prisma.dividendReportUpload.create({
      data: { filename: "dr.csv", fileHash: "h2", taxYear: 2025, recordCount: 2 },
    });
    await prisma.dividendReportRecord.createMany({
      data: [
        {
          uploadId: upload.id,
          symbol: "QZDO",
          payDate: new Date("2026-01-15"),
          revenueComponent: "Ordinary Dividend",
          taxCategory: "DIVIDEND",
          currency: "USD",
          grossUsd: 10.140405,
          withholdUsd: -1.52106075,
        },
        {
          uploadId: upload.id,
          symbol: "QZDO",
          payDate: new Date("2026-01-15"),
          revenueComponent: "Interest from RIC or REIT",
          taxCategory: "INTEREST",
          currency: "USD",
          grossUsd: 100.859595,
          withholdUsd: 0,
        },
      ],
    });

    const divs = await taxCalculationService.getDividends(2026);
    const qzdoDiv = divs.dividends.find((d) => d.symbol === "QZDO");
    expect(qzdoDiv?.grossUsd).toBeCloseTo(10.14, 2);
    expect(qzdoDiv?.withholdingTaxUsd).toBeCloseTo(1.52, 2);
    expect(qzdoDiv?.source).toBe("dividend-report");

    const interest = await taxCalculationService.getInterest(2026);
    const qzdoInt = interest.interest.find((i) => i.symbol === "QZDO");
    expect(qzdoInt?.amountUsd).toBeCloseTo(100.86, 2);
  });

  it("uncovered FLEX dividend keeps its FLEX classification with source='flex'", async () => {
    const batch = await seedImportBatch();
    await seedRate("2025-03-27");
    await prisma.cashTransaction.createMany({
      data: [
        {
          importBatchId: batch.id,
          transactionId: "zyn-div",
          symbol: "ZYN",
          description: "ZYN CASH DIVIDEND USD 0.9487 PER SHARE (Ordinary Dividend)",
          transactionDate: new Date("2025-03-27"),
          amount: 94.87,
          currency: "USD",
          type: "DIVIDEND",
        },
        {
          importBatchId: batch.id,
          transactionId: "zyn-wht",
          symbol: "ZYN",
          description: "ZYN CASH DIVIDEND USD 0.9487 PER SHARE - US TAX",
          transactionDate: new Date("2025-03-27"),
          amount: -14.23,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
      ],
    });

    const result = await taxCalculationService.getDividends(2025);
    const zyn = result.dividends.find((d) => d.symbol === "ZYN");
    expect(zyn?.source).toBe("flex");
    expect(zyn?.grossUsd).toBeCloseTo(94.87, 2);
    expect(zyn?.withholdingTaxUsd).toBeCloseTo(14.23, 2);
  });

  it("year-month match: ZEB FLEX 2025-05-15 is covered by DR 2025-05-16 (no double-count)", async () => {
    // FLEX and IBKR's Dividend Report disagree on the exact pay-date for the
    // same payment (a few days' drift). Coverage is at (symbol, YYYY-MM).
    const batch = await seedImportBatch();
    await seedRate("2025-05-15");
    await seedRate("2025-05-16");

    await prisma.cashTransaction.createMany({
      data: [
        {
          importBatchId: batch.id,
          transactionId: "zeb-div-may",
          symbol: "ZEB",
          description: "ZEB CASH DIVIDEND USD 0.044467 PER SHARE (Ordinary Div - NRA Withholding Exempt)",
          transactionDate: new Date("2025-05-15"),
          amount: 8.49,
          currency: "USD",
          type: "DIVIDEND",
        },
        {
          importBatchId: batch.id,
          transactionId: "zeb-wht-may",
          symbol: "ZEB",
          description: "ZEB CASH DIVIDEND USD 0.044467 PER SHARE - FI TAX",
          transactionDate: new Date("2025-05-15"),
          amount: -2.97,
          currency: "USD",
          type: "WITHHOLDING_TAX",
        },
      ],
    });

    const upload = await prisma.dividendReportUpload.create({
      data: { filename: "dr.csv", fileHash: "h-zeb-may", taxYear: 2025, recordCount: 1 },
    });
    await prisma.dividendReportRecord.create({
      data: {
        uploadId: upload.id,
        symbol: "ZEB",
        country: "FI",
        payDate: new Date("2025-05-16"),
        revenueComponent: "Ordinary Div - NRA Withholding Exempt",
        taxCategory: "DIVIDEND",
        currency: "USD",
        grossUsd: 8.49,
        withholdUsd: -2.97,
      },
    });

    const result = await taxCalculationService.getDividends(2025);
    const zeb = result.dividends.filter((d) => d.symbol === "ZEB");
    // Exactly one ZEB row, sourced from the Dividend Report; FLEX row dropped.
    expect(zeb).toHaveLength(1);
    expect(zeb[0].source).toBe("dividend-report");
    expect(zeb[0].grossUsd).toBeCloseTo(8.49, 2);
    expect(zeb[0].withholdingTaxUsd).toBeCloseTo(2.97, 2);
    // The May DR record is now matched, so it doesn't appear in unmatched.
    expect(result.unmatchedDividendReport).toEqual([]);
  });
});
