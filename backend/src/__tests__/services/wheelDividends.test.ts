import { describe, it, expect } from "vitest";
import {
  parseDividendPerShare,
  buildDividendPayments,
  type DividendCashRow,
} from "../../services/wheelDividends.js";

const row = (
  type: DividendCashRow["type"],
  date: string,
  amountUsd: number,
  description: string
): DividendCashRow => ({
  type,
  transactionDate: new Date(`${date}T00:00:00.000Z`),
  description,
  amountUsd,
});

const TLT_DESC = "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE (Ordinary Dividend)";
const TLT_WHT_DESC = "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE - US TAX";
const ARCC_DESC = "QZKU (USZ245564225) CASH DIVIDEND USD 0.48 (Ordinary Dividend)";

describe("parseDividendPerShare", () => {
  it("parses the PER SHARE form", () => {
    expect(parseDividendPerShare(TLT_DESC)).toBeCloseTo(0.330454, 10);
  });

  it("parses the form without a PER SHARE suffix", () => {
    expect(parseDividendPerShare(ARCC_DESC)).toBeCloseTo(0.48, 10);
  });

  it("returns null when no rate is present", () => {
    expect(parseDividendPerShare("TLT(USZ958700214) CASH DIVIDEND (Ordinary Dividend)")).toBeNull();
  });
});

describe("buildDividendPayments", () => {
  it("nets withholding tax against the dividend for one pay date", () => {
    const payments = buildDividendPayments("TLT", [
      row("DIVIDEND", "2026-08-06", 66.09, TLT_DESC),
      row("WITHHOLDING_TAX", "2026-08-06", -9.91, TLT_WHT_DESC),
    ]);

    expect(payments).toHaveLength(1);
    expect(payments[0].payDate).toBe("2026-08-06");
    expect(payments[0].gross).toBeCloseTo(66.09, 6);
    expect(payments[0].withholdingTax).toBeCloseTo(-9.91, 6);
    expect(payments[0].net).toBeCloseTo(56.18, 6);
    expect(payments[0].perShare).toBeCloseTo(0.330454, 10);
    // IBKR rounds the paid total to cents, so the derived share count lands
    // fractionally short of the round 200 shares actually held.
    expect(payments[0].sharesPaidOn).toBeCloseTo(200, 2);
  });

  it("collapses IBKR cancel/re-issue withholding rows to the surviving amount", () => {
    // Observed QZDO pattern: original, cancellation and re-issue rows on one date.
    const payments = buildDividendPayments("QZDO", [
      row(
        "DIVIDEND",
        "2026-07-15",
        93,
        "QZDO (USZ825137254) CASH DIVIDEND USD 0.31 PAYMENT IN LIEU OF DIVIDEND (Ordinary Dividend)"
      ),
      row("WITHHOLDING_TAX", "2026-07-15", -13.95, "QZDO - US TAX"),
      row("WITHHOLDING_TAX", "2026-07-15", 27.9, "QZDO - US TAX"),
      row("WITHHOLDING_TAX", "2026-07-15", -13.95, "QZDO - US TAX"),
      row("WITHHOLDING_TAX", "2026-07-15", 13.95, "QZDO - US TAX"),
      row("WITHHOLDING_TAX", "2026-07-15", -27.9, "QZDO - US TAX"),
    ]);

    expect(payments).toHaveLength(1);
    expect(payments[0].withholdingTax).toBeCloseTo(-13.95, 6);
    expect(payments[0].net).toBeCloseTo(79.05, 6);
  });

  it("skips date groups that carry withholding rows but no dividend", () => {
    const payments = buildDividendPayments("TLT", [
      row("WITHHOLDING_TAX", "2026-02-10", -4.2, "TLT - US TAX"),
    ]);

    expect(payments).toEqual([]);
  });

  it("returns payments sorted by pay date", () => {
    const payments = buildDividendPayments("TLT", [
      row("DIVIDEND", "2026-08-06", 66.09, TLT_DESC),
      row(
        "DIVIDEND",
        "2026-07-07",
        63.61,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.31803 PER SHARE (Ordinary Dividend)"
      ),
    ]);

    expect(payments.map((p) => p.payDate)).toEqual(["2026-07-07", "2026-08-06"]);
  });

  it("throws naming the symbol, date and description when the rate cannot be parsed", () => {
    expect(() =>
      buildDividendPayments("TLT", [
        row("DIVIDEND", "2026-08-06", 66.09, "TLT(USZ958700214) CASH DIVIDEND (Ordinary Dividend)"),
      ])
    ).toThrow(/TLT.*2026-08-06.*CASH DIVIDEND \(Ordinary Dividend\)/s);
  });

  it("throws when the parsed rate is zero", () => {
    expect(() =>
      buildDividendPayments("TLT", [
        row("DIVIDEND", "2026-08-06", 66.09, "TLT(USZ958700214) CASH DIVIDEND USD 0 PER SHARE"),
      ])
    ).toThrow(/rate of 0/);
  });
});
