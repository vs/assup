import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDividendReportCsv } from "../../services/dividendReportImport.service.js";

const FIXTURE = readFileSync(
  join(__dirname, "../fixtures/dividend-report-2025.csv"),
  "utf-8"
);

describe("parseDividendReportCsv", () => {
  it("parses account metadata", () => {
    const result = parseDividendReportCsv(FIXTURE);
    expect(result.accountNumber).toBe("U00000000");
    expect(result.baseCurrency).toBe("USD");
  });

  it("parses RevenueComponent rows and skips Summary rows", () => {
    const result = parseDividendReportCsv(FIXTURE);
    // 8 RevenueComponent rows in the fixture (ZUX, ZEB, QZDO×2, ZAR, TLT×2, ZYN).
    expect(result.records.length).toBe(8);
    // Summary rows must not be present.
    const symbols = result.records.map((r) => r.symbol);
    expect(symbols.filter((s) => s === "TLT").length).toBe(2);
    expect(symbols.filter((s) => s === "QZDO").length).toBe(2);
  });

  it("maps RevenueComponent strings to taxCategory", () => {
    const result = parseDividendReportCsv(FIXTURE);
    const tlt = result.records.find((r) => r.symbol === "TLT");
    expect(tlt?.taxCategory).toBe("INTEREST");
    expect(tlt?.revenueComponent).toBe("Interest from RIC or REIT");

    const zux = result.records.find((r) => r.symbol === "ZUX");
    expect(zux?.taxCategory).toBe("DIVIDEND");
    expect(zux?.revenueComponent).toBe("Ordinary Dividend");

    const zeb = result.records.find((r) => r.symbol === "ZEB");
    expect(zeb?.taxCategory).toBe("DIVIDEND");
    expect(zeb?.revenueComponent).toBe("Ordinary Div - NRA Withholding Exempt");
  });

  it("parses gross and withholding amounts with full precision", () => {
    const result = parseDividendReportCsv(FIXTURE);
    const qzdoInterest = result.records.find(
      (r) => r.symbol === "QZDO" && r.taxCategory === "INTEREST"
    );
    expect(qzdoInterest?.grossUsd).toBeCloseTo(50.429797, 6);
    expect(qzdoInterest?.withholdUsd).toBe(0);

    const qzdoDividend = result.records.find(
      (r) => r.symbol === "QZDO" && r.taxCategory === "DIVIDEND"
    );
    expect(qzdoDividend?.grossUsd).toBeCloseTo(5.070203, 6);
    expect(qzdoDividend?.withholdUsd).toBeCloseTo(-0.76053045, 6);
  });

  it("parses payDate and exDate from YYYYMMDD strings", () => {
    const result = parseDividendReportCsv(FIXTURE);
    const tlt = result.records.find(
      (r) => r.symbol === "TLT" && r.payDate.toISOString().slice(0, 10) === "2025-12-04"
    );
    expect(tlt?.payDate.toISOString().slice(0, 10)).toBe("2025-12-04");
    expect(tlt?.exDate?.toISOString().slice(0, 10)).toBe("2025-12-01");
  });

  it("computes taxYear as the modal year of payDate", () => {
    const result = parseDividendReportCsv(FIXTURE);
    // Fixture has 6 rows in 2025 (ZUX, ZEB, ZAR, TLT×2, ZYN) and 2 rows in
    // 2026 (QZDO×2, payDate 2026-01-15) → modal year is 2025.
    expect(result.taxYear).toBe(2025);
  });

  it("validates Summary totals against component sums", () => {
    // Construct a corrupted variant where one component's Gross doesn't add up
    // to its Summary.
    const corrupted = FIXTURE.replace(
      `DividendDetail,Data,RevenueComponent,USD,ZUX,1000001,CA,20251216,20251201,,Ordinary Dividend,Qualified - Meets Holding Period,20.96,20.96,20.96,-3.14,-3.14,-3.14,`,
      `DividendDetail,Data,RevenueComponent,USD,ZUX,1000001,CA,20251216,20251201,,Ordinary Dividend,Qualified - Meets Holding Period,25.00,25.00,25.00,-3.14,-3.14,-3.14,`
    );
    expect(() => parseDividendReportCsv(corrupted)).toThrow(
      /ZUX.*2025-12-16.*Gross.*delta/i
    );
  });

  it("hard-fails on an unrecognised RevenueComponent", () => {
    const unrecognised = FIXTURE.replace(
      "Ordinary Div - NRA Withholding Exempt",
      "Made-Up Tax Category"
    );
    expect(() => parseDividendReportCsv(unrecognised)).toThrow(
      /Made-Up Tax Category/
    );
  });
});
