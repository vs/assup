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
