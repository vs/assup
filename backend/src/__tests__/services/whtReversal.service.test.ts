import { describe, it, expect } from "vitest";
import { matchWhtReversals, type WhtRow } from "../../services/whtReversal.service.js";

function row(
  transactionId: string,
  date: string,
  amount: number,
  description: string,
  symbol = ""
): WhtRow {
  return {
    transactionId,
    symbol,
    description,
    amount,
    transactionDate: new Date(`${date}T00:00:00.000Z`),
    currency: "USD",
  };
}

describe("matchWhtReversals", () => {
  it("pairs broker-interest WITHHOLDING and CANCEL by period tag", () => {
    const rows = [
      row("a1", "2025-01-06", -163.08, "WITHHOLDING @ 20% ON CREDIT INT FOR DEC-2024"),
      row("a2", "2025-02-20", 163.08, "CANCEL WITHHOLDING ON CREDIT INT FOR DEC-2024"),
    ];
    const result = matchWhtReversals(rows);
    expect(result.statusByTxnId.get("a1")).toBe("original-paired");
    expect(result.statusByTxnId.get("a2")).toBe("reversed");
    expect(result.pairings.length).toBe(1);
  });

  it("does not pair WITHHOLDING and CANCEL with different period tags", () => {
    const rows = [
      row("a1", "2025-01-06", -163.08, "WITHHOLDING @ 20% ON CREDIT INT FOR DEC-2024"),
      row("a2", "2025-02-20", 163.08, "CANCEL WITHHOLDING ON CREDIT INT FOR JAN-2025"),
    ];
    const result = matchWhtReversals(rows);
    expect(result.statusByTxnId.get("a1")).toBe("original-unpaired");
    expect(result.statusByTxnId.get("a2")).toBe("unpaired");
  });

  it("pairs ticker-tied WHT and REVERSAL by (symbol, per-share)", () => {
    const rows = [
      row(
        "t1",
        "2025-12-04",
        -4.81,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE - US TAX",
        "TLT"
      ),
      row(
        "t2",
        "2026-02-05",
        4.81,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE - US TAX REVERSAL",
        "TLT"
      ),
    ];
    const result = matchWhtReversals(rows);
    expect(result.statusByTxnId.get("t1")).toBe("original-paired");
    expect(result.statusByTxnId.get("t2")).toBe("reversed");
  });

  it("does not pair ticker WHT with different per-share amounts", () => {
    const rows = [
      row(
        "t1",
        "2025-12-04",
        -4.81,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE - US TAX",
        "TLT"
      ),
      row(
        "t2",
        "2026-02-06",
        10.27,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.342437 PER SHARE - US TAX REVERSAL",
        "TLT"
      ),
    ];
    const result = matchWhtReversals(rows);
    expect(result.statusByTxnId.get("t1")).toBe("original-unpaired");
    expect(result.statusByTxnId.get("t2")).toBe("unpaired");
  });

  it("leaves ZEB same-day triple-entry alone (no reversal keyword, sign-based pairing only when amounts match)", () => {
    // Three rows on the same date for ZEB FI TAX: -2.09, +2.09, -2.09.
    // The +2.09 IS effectively a reversal of one of the -2.09s (amount-based),
    // so we expect one pair and one unpaired original.
    const rows = [
      row("n1", "2025-02-18", -2.09, "ZEB(USZ631897822) CASH DIVIDEND USD 0.031193 PER SHARE - FI TAX", "ZEB"),
      row("n2", "2025-02-18", 2.09, "ZEB(USZ631897822) CASH DIVIDEND USD 0.031193 PER SHARE - FI TAX", "ZEB"),
      row("n3", "2025-02-18", -2.09, "ZEB(USZ631897822) CASH DIVIDEND USD 0.031193 PER SHARE - FI TAX", "ZEB"),
    ];
    const result = matchWhtReversals(rows);
    // Either (n1,n2) pair and n3 unpaired-original, or any valid pairing.
    // What we assert: exactly one pair, one original-unpaired, one reversed.
    const statuses = [...result.statusByTxnId.values()].sort();
    expect(statuses).toEqual(["original-paired", "original-unpaired", "reversed"]);
    expect(result.pairings.length).toBe(1);
  });

  it("classifies a positive WHT row with no matching original as unpaired", () => {
    const rows = [
      row("orphan", "2026-03-01", 50.0, "CANCEL WITHHOLDING ON CREDIT INT FOR FEB-2024"),
    ];
    const result = matchWhtReversals(rows);
    expect(result.statusByTxnId.get("orphan")).toBe("unpaired");
  });

  it("pairs same-date ticker WHT regardless of input order (cancel back-dated to original)", () => {
    // IBKR sometimes posts the cancel back-dated to the original's transaction
    // date. The reversal can therefore appear in input order BEFORE the
    // original. The matcher must still pair them.
    const rows = [
      row(
        "rev-first",
        "2025-12-04",
        4.81,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE - US TAX",
        "TLT"
      ),
      row(
        "orig-second",
        "2025-12-04",
        -4.81,
        "TLT(USZ958700214) CASH DIVIDEND USD 0.320648 PER SHARE - US TAX",
        "TLT"
      ),
    ];
    const result = matchWhtReversals(rows);
    expect(result.statusByTxnId.get("orig-second")).toBe("original-paired");
    expect(result.statusByTxnId.get("rev-first")).toBe("reversed");
    expect(result.pairings).toHaveLength(1);
  });
});
