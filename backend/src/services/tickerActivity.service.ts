/**
 * Per-ticker activity log.
 *
 * Composes the existing trade-matching and dividend primitives into a single
 * per-symbol view of everything that produced profit or loss. The computation is
 * a pure function so it is unit-testable without a database or a TWS connection;
 * `getTickerActivity` is the thin DB/IBKR wrapper around it.
 */

import type {
  Position,
  TickerActivity,
  TickerActivityEntry,
  TickerActivitySummary,
  WheelMatchedTrade,
} from "@assup/shared";
import {
  groupOptionTrades,
  groupStockTradesForWheel,
  optionGroupToWheelMatchedTrade,
  stockGroupToWheelMatchedTrade,
  type OptionTradeInput,
  type StockTradeInput,
} from "./tradeMatching.js";
import { buildDividendPayments, type DividendCashRow } from "./wheelDividends.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateKey = (date: Date): string => date.toISOString().split("T")[0];

/**
 * The date a row sorts by: its close date once closed, its open date while open.
 *
 * `optionGroupToWheelMatchedTrade` can synthesize an open leg dated
 * "(before report period)" when the opening trade predates the FLEX import, so
 * non-ISO dates are rejected rather than sorted as text.
 */
function pickSortDate(trade: WheelMatchedTrade): string {
  const open = trade.openLeg?.date;
  const close = trade.closeLeg?.date;
  if (trade.status !== "open" && close && ISO_DATE.test(close)) return close;
  if (open && ISO_DATE.test(open)) return open;
  if (close && ISO_DATE.test(close)) return close;
  return "";
}

function toEntry(
  trade: WheelMatchedTrade,
  kind: "OPTION" | "STOCK"
): TickerActivityEntry {
  return {
    id: trade.id,
    kind,
    displayName: trade.displayName,
    status: trade.status,
    sortDate: pickSortDate(trade),
    realizedPnL: trade.status === "open" ? null : trade.netPnL,
    unrealizedPnL: null,
    openLeg: trade.openLeg,
    closeLeg: trade.closeLeg,
    dividend: null,
  };
}

/**
 * Dates on which shares were called away by an assigned covered call.
 *
 * Anchored on the call's expiry, not its trade date: the trade date is when the
 * call was *sold*, while assignment settles the shares at expiry. An early
 * assignment therefore won't be recognised and its share lot stays "closed" —
 * understating the label is better than attaching it to the wrong lot.
 */
function calledAwayDates(optionTrades: OptionTradeInput[]): Set<string> {
  const dates = new Set<string>();
  for (const trade of optionTrades) {
    if (trade.wasAssigned && trade.right === "C" && trade.expiry) {
      dates.add(dateKey(trade.expiry));
    }
  }
  return dates;
}

function dividendToEntry(
  symbol: string,
  payment: ReturnType<typeof buildDividendPayments>[number]
): TickerActivityEntry {
  const shares = Math.round(payment.sharesPaidOn);
  return {
    id: `${symbol}-div-${payment.payDate}`,
    kind: "DIVIDEND",
    displayName: `Dividend $${payment.perShare.toFixed(4)} × ${shares} shares`,
    status: "paid",
    sortDate: payment.payDate,
    realizedPnL: payment.net,
    unrealizedPnL: null,
    openLeg: null,
    closeLeg: {
      date: payment.payDate,
      action: "Dividend received",
      price: payment.perShare,
      quantity: shares,
      total: payment.gross,
    },
    dividend: {
      perShare: payment.perShare,
      shares,
      gross: payment.gross,
      withholdingTax: payment.withholdingTax,
      net: payment.net,
    },
  };
}

function emptySummary(): TickerActivitySummary {
  return {
    optionsPnL: 0,
    stockPnL: 0,
    dividends: 0,
    total: 0,
    entryCount: 0,
    firstDate: null,
    lastDate: null,
  };
}

function summarize(entries: TickerActivityEntry[]): TickerActivitySummary {
  const summary = emptySummary();

  for (const entry of entries) {
    const pnl = entry.realizedPnL;
    if (pnl !== null) {
      if (entry.kind === "OPTION") summary.optionsPnL += pnl;
      else if (entry.kind === "STOCK") summary.stockPnL += pnl;
      else summary.dividends += pnl;
      summary.entryCount += 1;
    }

    if (!entry.sortDate) continue;
    if (summary.firstDate === null || entry.sortDate < summary.firstDate) {
      summary.firstDate = entry.sortDate;
    }
    if (summary.lastDate === null || entry.sortDate > summary.lastDate) {
      summary.lastDate = entry.sortDate;
    }
  }

  summary.total = summary.optionsPnL + summary.stockPnL + summary.dividends;
  return summary;
}

/**
 * Build the activity log for one symbol.
 *
 * All inputs are already fetched, filtered to the symbol, and USD-converted.
 * `positions` are live IBKR positions used only to attach unrealized P&L to open
 * entries; an empty array (TWS disconnected) simply leaves them null.
 */
export function buildTickerActivity(
  symbol: string,
  optionTrades: OptionTradeInput[],
  stockTrades: StockTradeInput[],
  dividendRows: DividendCashRow[],
  positions: Position[]
): TickerActivity {
  void positions;

  const entries: TickerActivityEntry[] = [];

  for (const group of groupOptionTrades(optionTrades)) {
    entries.push(toEntry(optionGroupToWheelMatchedTrade(group, symbol), "OPTION"));
  }

  const calledAwayOn = calledAwayDates(optionTrades);
  for (const group of groupStockTradesForWheel(stockTrades)) {
    const entry = toEntry(stockGroupToWheelMatchedTrade(group), "STOCK");
    // A share lot sold on a day a covered call was assigned was called away, not
    // sold at market. The premium itself stays on the option's own row.
    if (entry.status === "closed" && entry.closeLeg && calledAwayOn.has(entry.closeLeg.date)) {
      entry.status = "called_away";
      entry.closeLeg = { ...entry.closeLeg, action: "Called away" };
    }
    entries.push(entry);
  }

  for (const payment of buildDividendPayments(symbol, dividendRows)) {
    entries.push(dividendToEntry(symbol, payment));
  }

  const open = entries
    .filter((e) => e.status === "open")
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  const closed = entries
    .filter((e) => e.status !== "open")
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  return { symbol, open, closed, summary: summarize(entries) };
}
