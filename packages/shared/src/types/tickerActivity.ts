/**
 * Per-ticker activity log types.
 *
 * One entry = one thing that produced (or is producing) profit or loss for a
 * symbol: an option round-trip, a share lot, or a dividend payment.
 */

export type TickerActivityKind = "OPTION" | "STOCK" | "DIVIDEND";

export type TickerActivityStatus =
  | "open"
  | "closed"
  | "expired"
  | "assigned"
  | "called_away"
  | "paid";

export interface TickerActivityLeg {
  /** YYYY-MM-DD, or "(before report period)" when synthesized from IBKR cost basis */
  date: string;
  /** "Sold PUT", "Bought 100 shares", "Expired worthless", … */
  action: string;
  /** Per-share / per-contract price; null when not applicable */
  price: number | null;
  quantity: number;
  /** Signed cash: positive = received, negative = paid */
  total: number;
}

export interface TickerActivityDividendDetail {
  perShare: number;
  shares: number;
  gross: number;
  /** Negative */
  withholdingTax: number;
  /** gross + withholdingTax */
  net: number;
}

export interface TickerActivityEntry {
  id: string;
  kind: TickerActivityKind;
  /** "TLT Jan30'26 89 PUT" | "100 TLT shares" | "Dividend $0.3305 × 100 shares" */
  displayName: string;
  status: TickerActivityStatus;
  /** Close date when closed, open date otherwise. Drives sorting. "" when unknown. */
  sortDate: string;
  /** Realized P&L; null while the entry is open */
  realizedPnL: number | null;
  /** Live unrealized P&L for open entries; null when closed or TWS unavailable */
  unrealizedPnL: number | null;
  openLeg: TickerActivityLeg | null;
  closeLeg: TickerActivityLeg | null;
  /** Populated only when kind === "DIVIDEND" */
  dividend: TickerActivityDividendDetail | null;
}

export interface TickerActivitySummary {
  optionsPnL: number;
  stockPnL: number;
  /** Net of withholding tax */
  dividends: number;
  /** optionsPnL + stockPnL + dividends */
  total: number;
  /** Number of closed entries */
  entryCount: number;
  /** Earliest / latest sortDate across all entries; null when there are none */
  firstDate: string | null;
  lastDate: string | null;
}

export interface TickerActivity {
  symbol: string;
  /** Currently open options and share lots, pinned above the history */
  open: TickerActivityEntry[];
  /** Completed entries, newest first */
  closed: TickerActivityEntry[];
  summary: TickerActivitySummary;
}
