/**
 * Wheel dividend attribution.
 *
 * Turns IBKR cash transactions (dividends + withholding tax) into per-pay-date
 * payments, then attributes each payment to the wheel cycle that actually held
 * shares when it was paid. Kept separate from wheel.service.ts so the rules are
 * unit-testable without trade reconstruction or a database.
 */

import type { WheelDividend } from "@assup/shared";
import { prisma } from "../db/index.js";
import { convertToUsd } from "./currency.js";

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

/** A period during which one cycle held a fixed number of shares. */
export interface ShareSegment {
  cycleNumber: number;
  from: Date;
  /** null while the cycle still holds these shares */
  to: Date | null;
  shares: number;
}

/**
 * How long after a share exit a dividend may still be credited to that cycle.
 *
 * IBKR gives us the pay date only, and pay dates trail ex-dates by 2-4 weeks, so
 * a dividend earned before an assignment or called-away exit routinely lands after
 * the cycle closed. The window stands in for the missing ex-date.
 */
export const DIVIDEND_GRACE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Attribute each payment to the cycle that earned it, keyed by cycle number.
 *
 * 1. A segment covering the pay date with shares wins.
 * 2. Otherwise the most recently exited share-holding segment, if it ended within
 *    DIVIDEND_GRACE_DAYS before the pay date.
 * 3. Otherwise the payment is dropped — a CSP-only cycle or a gap between cycles
 *    earns no dividend.
 *
 * The credited amount is scaled by `segment.shares / payment.sharesPaidOn`, which
 * keeps the non-wheel part of a larger holding out of the cycle and scales the
 * withholding along with the gross.
 */
export function attributeDividends(
  symbol: string,
  payments: DividendPayment[],
  segments: ShareSegment[]
): Map<number, WheelDividend[]> {
  const byCycle = new Map<number, WheelDividend[]>();
  const holdingSegments = segments.filter((s) => s.shares > 0);

  for (const payment of payments) {
    const paidAt = new Date(`${payment.payDate}T00:00:00.000Z`).getTime();

    let match = holdingSegments.find(
      (s) => s.from.getTime() <= paidAt && (s.to === null || paidAt <= s.to.getTime())
    );

    if (!match) {
      // Grace window: the most recent exit that is still within range.
      let best: ShareSegment | undefined;
      for (const segment of holdingSegments) {
        if (segment.to === null) continue;
        const endedAt = segment.to.getTime();
        if (endedAt >= paidAt) continue;
        if (paidAt - endedAt > DIVIDEND_GRACE_DAYS * DAY_MS) continue;
        if (!best || segment.to.getTime() > best.to!.getTime()) best = segment;
      }
      match = best;
    }

    if (!match) continue;

    const ratio = payment.sharesPaidOn > 0 ? match.shares / payment.sharesPaidOn : 0;
    const gross = payment.gross * ratio;
    const withholdingTax = payment.withholdingTax * ratio;

    const dividend: WheelDividend = {
      id: `${symbol}-${payment.payDate}`,
      payDate: payment.payDate,
      perShare: payment.perShare,
      shares: match.shares,
      gross,
      withholdingTax,
      net: gross + withholdingTax,
    };

    const existing = byCycle.get(match.cycleNumber);
    if (existing) existing.push(dividend);
    else byCycle.set(match.cycleNumber, [dividend]);
  }

  for (const dividends of byCycle.values()) {
    dividends.sort((a, b) => a.payDate.localeCompare(b.payDate));
  }

  return byCycle;
}

const DIVIDEND_CASH_TYPES = ["DIVIDEND", "WITHHOLDING_TAX"] as const;

const cashRowSelect = {
  symbol: true,
  type: true,
  transactionDate: true,
  description: true,
  amount: true,
  currency: true,
};

interface RawCashRow {
  symbol: string | null;
  type: string;
  transactionDate: Date;
  description: string;
  amount: number;
  currency: string;
}

const toDividendCashRow = async (row: RawCashRow): Promise<DividendCashRow> => ({
  type: row.type as DividendCashRow["type"],
  transactionDate: row.transactionDate,
  description: row.description,
  amountUsd: await convertToUsd(row.amount, row.currency, row.transactionDate),
});

/** Dividend + withholding rows for one ticker, converted to USD. */
export async function fetchDividendCashRows(
  symbol: string,
  startDate: Date | null
): Promise<DividendCashRow[]> {
  const rows = (await prisma.cashTransaction.findMany({
    where: {
      symbol,
      type: { in: [...DIVIDEND_CASH_TYPES] },
      ...(startDate ? { transactionDate: { gte: startDate } } : {}),
    },
    orderBy: { transactionDate: "asc" },
    select: cashRowSelect,
  })) as RawCashRow[];

  return Promise.all(rows.map(toDividendCashRow));
}

/**
 * Batch variant for the tracked-ticker list: one query for every symbol.
 * Per-symbol start dates are applied by the caller, which already filters trades
 * the same way.
 */
export async function fetchDividendCashRowsForSymbols(
  symbols: string[]
): Promise<Map<string, DividendCashRow[]>> {
  const bySymbol = new Map<string, DividendCashRow[]>();
  if (symbols.length === 0) return bySymbol;

  const rows = (await prisma.cashTransaction.findMany({
    where: {
      symbol: { in: symbols },
      type: { in: [...DIVIDEND_CASH_TYPES] },
    },
    orderBy: { transactionDate: "asc" },
    select: cashRowSelect,
  })) as RawCashRow[];

  for (const row of rows) {
    if (!row.symbol) continue;
    const converted = await toDividendCashRow(row);
    const existing = bySymbol.get(row.symbol);
    if (existing) existing.push(converted);
    else bySymbol.set(row.symbol, [converted]);
  }

  return bySymbol;
}

/** Count + latest pay date, used to invalidate the wheel summary cache. */
export async function getDividendStats(
  symbol: string,
  startDate: Date | null
): Promise<{ dividendCount: number; lastDividendDate: Date | null }> {
  const stats = await prisma.cashTransaction.aggregate({
    where: {
      symbol,
      type: { in: [...DIVIDEND_CASH_TYPES] },
      ...(startDate ? { transactionDate: { gte: startDate } } : {}),
    },
    _count: { _all: true },
    _max: { transactionDate: true },
  });

  return {
    dividendCount: stats._count._all,
    lastDividendDate: stats._max.transactionDate ?? null,
  };
}
