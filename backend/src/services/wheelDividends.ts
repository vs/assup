/**
 * Wheel dividend attribution.
 *
 * Turns IBKR cash transactions (dividends + withholding tax) into per-pay-date
 * payments, then attributes each payment to the wheel cycle that actually held
 * shares when it was paid. Kept separate from wheel.service.ts so the rules are
 * unit-testable without trade reconstruction or a database.
 */

/** One raw cash-transaction row, already converted to USD. */
export interface DividendCashRow {
  type: "DIVIDEND" | "WITHHOLDING_TAX";
  transactionDate: Date;
  description: string;
  amountUsd: number;
}

/** All cash for one symbol on one pay date, netted. */
export interface DividendPayment {
  /** YYYY-MM-DD */
  payDate: string;
  /** Dividend rate per share as declared by IBKR */
  perShare: number;
  /** Gross dividend received (USD) */
  gross: number;
  /** Withholding tax (USD, negative) */
  withholdingTax: number;
  /** gross + withholdingTax */
  net: number;
  /** Shares the payment covered: gross / perShare */
  sharesPaidOn: number;
}

const dateKey = (date: Date): string => date.toISOString().split("T")[0];

/**
 * Extract the declared per-share rate from an IBKR dividend description.
 *
 * Both observed shapes are supported:
 *   "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE (Ordinary Dividend)"
 *   "QZKU (USZ245564225) CASH DIVIDEND USD 0.48 (Ordinary Dividend)"
 */
export function parseDividendPerShare(description: string): number | null {
  const match = description.match(/CASH DIVIDEND\s+[A-Z]{3}\s+([0-9]*\.?[0-9]+)/i);
  if (!match) return null;
  const rate = parseFloat(match[1]);
  return Number.isFinite(rate) ? rate : null;
}

/**
 * Group cash rows into one netted payment per pay date.
 *
 * IBKR emits cancel/re-issue withholding rows (up to five for a single payment);
 * summing them per date collapses the sequence to the surviving amount.
 *
 * Date groups holding only withholding rows are skipped: those are interest
 * withholding or orphan reversals, not wheel dividend income.
 */
export function buildDividendPayments(
  symbol: string,
  rows: DividendCashRow[]
): DividendPayment[] {
  const groups = new Map<string, DividendCashRow[]>();
  for (const row of rows) {
    const key = dateKey(row.transactionDate);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const payments: DividendPayment[] = [];

  for (const [payDate, group] of groups) {
    const dividendRows = group.filter((r) => r.type === "DIVIDEND");
    if (dividendRows.length === 0) continue;

    const gross = dividendRows.reduce((sum, r) => sum + r.amountUsd, 0);
    const withholdingTax = group
      .filter((r) => r.type === "WITHHOLDING_TAX")
      .reduce((sum, r) => sum + r.amountUsd, 0);

    const rated = dividendRows.find((r) => parseDividendPerShare(r.description) !== null);
    if (!rated) {
      throw new Error(
        `Cannot determine the per-share dividend rate for ${symbol} paid on ${payDate}. ` +
          `Description: "${dividendRows[0].description}". ` +
          `Expected the IBKR form "CASH DIVIDEND <CCY> <rate> [PER SHARE] ...". ` +
          `Re-import the FLEX report with full cash-transaction descriptions.`
      );
    }

    const perShare = parseDividendPerShare(rated.description)!;
    if (perShare === 0) {
      throw new Error(
        `${symbol} dividend paid on ${payDate} declares a per-share rate of 0 ` +
          `("${rated.description}"), so the share count cannot be derived.`
      );
    }

    payments.push({
      payDate,
      perShare,
      gross,
      withholdingTax,
      net: gross + withholdingTax,
      sharesPaidOn: gross / perShare,
    });
  }

  return payments.sort((a, b) => a.payDate.localeCompare(b.payDate));
}
