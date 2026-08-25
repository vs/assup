/**
 * Pure helpers for the Roll Out dialog.
 * No React imports — all functions take primitive / data inputs and return data outputs.
 */

import type { ActiveSpread, IronCondorChainStrike, IronCondorOrderLeg } from "@assup/shared";

export interface ChainQuote {
  strike: number;
  right: "P" | "C";
  conId: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
}

/** Build a fast quote lookup from a streamed chain. Key: `"<strike>:<right>"`. */
export function buildQuotesFromChain(chain: IronCondorChainStrike[]): Map<string, ChainQuote> {
  const quotes = new Map<string, ChainQuote>();
  for (const row of chain) {
    if (row.put) {
      quotes.set(`${row.strike}:P`, {
        strike: row.strike, right: "P", conId: row.put.conId,
        bid: row.put.bid, ask: row.put.ask, mid: row.put.mid, delta: row.put.delta,
      });
    }
    if (row.call) {
      quotes.set(`${row.strike}:C`, {
        strike: row.strike, right: "C", conId: row.call.conId,
        bid: row.call.bid, ask: row.call.ask, mid: row.call.mid, delta: row.call.delta,
      });
    }
  }
  return quotes;
}

/** Sorted ascending list of strikes that have an option of the given right in the chain. */
export function availableStrikesForRight(chain: IronCondorChainStrike[], right: "P" | "C"): number[] {
  const result: number[] = [];
  for (const row of chain) {
    const opt = right === "P" ? row.put : row.call;
    if (opt) result.push(row.strike);
  }
  return result.sort((a, b) => a - b);
}

/** Snap a target value to the nearest strike in `strikes`. Returns 0 if list is empty. */
export function snapToNearestStrike(target: number, strikes: number[]): number {
  if (strikes.length === 0) return 0;
  return strikes.reduce((prev, curr) =>
    Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev,
  );
}

/** Distinct positive deltas between adjacent strikes in `strikes`, sorted ascending. */
export function strikeIntervals(strikes: number[]): number[] {
  if (strikes.length < 2) return [];
  const sorted = [...strikes].sort((a, b) => a - b);
  const set = new Set<number>();
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 0) set.add(Math.round(d * 100) / 100);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Width of the existing spread (gap between the two lowest strikes when sorted).
 * Returns 0 if fewer than 2 strikes.
 *
 * Caller convention: this function assumes a 2-leg vertical spread. For iron
 * condors (4 legs), it returns the put-side wing only — callers must call
 * `extractSideSpread` first to operate on a single side.
 */
export function deriveWingWidth(spread: ActiveSpread): number {
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  if (strikes.length < 2) return 0;
  return strikes[1] - strikes[0];
}

/** Calendar-day count between two YYYYMMDD dates (b - a). */
export function calendarDaysBetween(yyyymmddA: string, yyyymmddB: string): number {
  const parse = (s: string) => new Date(
    parseInt(s.slice(0, 4)), parseInt(s.slice(4, 6)) - 1, parseInt(s.slice(6, 8)),
  );
  const ms = parse(yyyymmddB).getTime() - parse(yyyymmddA).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Filter expirations to only those strictly after `currentExpiry`, sorted ascending. */
export function expirationsBeyond(currentExpiry: string, all: string[]): string[] {
  return all.filter(e => e > currentExpiry).sort();
}

/** Pick the default target expiration: first one >= 30 calendar days beyond current; else nearest. */
export function defaultTargetExpiration(currentExpiry: string, all: string[]): string | null {
  const beyond = expirationsBeyond(currentExpiry, all);
  if (beyond.length === 0) return null;
  const ge30 = beyond.find(e => calendarDaysBetween(currentExpiry, e) >= 30);
  return ge30 ?? beyond[0];
}

/**
 * Default new short strike for a roll-out.
 * Calls: lowest strike with |delta| <= targetAbsDelta (or, if no deltas yet,
 *   lowest strike >= underlyingPrice * 1.05).
 * Puts: highest strike with |delta| <= targetAbsDelta (or, if no deltas yet,
 *   highest strike <= underlyingPrice * 0.95).
 * Falls back to nearest available if neither rule yields a candidate.
 */
export function defaultNewShortStrike(
  chain: IronCondorChainStrike[],
  isPut: boolean,
  targetAbsDelta: number,
  underlyingPrice: number,
): number {
  const right: "P" | "C" = isPut ? "P" : "C";
  const rows = chain.filter(r => (right === "P" ? r.put : r.call));
  if (rows.length === 0) return 0;

  // Delta-based pick — only consider rows where delta is present.
  const withDelta = rows.filter(r => {
    const opt = right === "P" ? r.put : r.call;
    return opt?.delta != null;
  });
  if (withDelta.length > 0) {
    const eligible = withDelta.filter(r => {
      const d = right === "P" ? r.put!.delta! : r.call!.delta!;
      return Math.abs(d) <= targetAbsDelta;
    });
    if (eligible.length > 0) {
      // For calls: lowest strike (closest to ATM that still meets the cap)
      // For puts: highest strike
      eligible.sort((a, b) => a.strike - b.strike);
      return isPut ? eligible[eligible.length - 1].strike : eligible[0].strike;
    }
  }

  // Distance fallback when no deltas have arrived yet.
  if (underlyingPrice > 0) {
    const sorted = [...rows].sort((a, b) => a.strike - b.strike);
    if (isPut) {
      const target = underlyingPrice * 0.95;
      const eligible = sorted.filter(r => r.strike <= target);
      return eligible.length > 0 ? eligible[eligible.length - 1].strike : sorted[0].strike;
    } else {
      const target = underlyingPrice * 1.05;
      const eligible = sorted.filter(r => r.strike >= target);
      return eligible.length > 0 ? eligible[0].strike : sorted[sorted.length - 1].strike;
    }
  }

  // Last-resort fallback: middle of the chain.
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  return sorted[Math.floor(sorted.length / 2)].strike;
}

/**
 * Snap the user's preferred wing width to one available in the chain's strike grid.
 * Picks the smallest interval >= preferred. Falls back to the largest available.
 */
export function snapWingWidth(preferred: number, intervals: number[]): number {
  if (intervals.length === 0) return preferred;
  const ge = intervals.find(i => i >= preferred);
  return ge ?? intervals[intervals.length - 1];
}

export interface RollEconomics {
  closeDebitMid: number;   // per contract — what the close combo costs at mid
  openCreditMid: number;   // per contract — what the new spread is worth at mid (positive = credit)
  netDebitMid: number;     // per contract — closeDebitMid - openCreditMid
}

/**
 * Compute roll economics at mid prices.
 * For a call spread close: BUY current short (pays ask), SELL current long (receives bid) → mid uses (mid_short - mid_long).
 * For a put spread close: same — combo is sign-symmetric since we're using the spread's own legs.
 * For a call spread open (new): SELL new short (mid), BUY new long (mid) → credit = mid_newShort - mid_newLong.
 * For a put spread open: same shape.
 *
 * Note on missing data: when a leg's mid is missing (null), this function
 * substitutes 0, matching the pre-existing CloseSpreadDialog convention. The
 * caller is responsible for gating display on quote completeness — e.g. only
 * render the economics block once `stream.status === "connected"` AND every
 * relevant leg has a non-null `midPrice`. Otherwise the UI may briefly show
 * `$0.00` close cost while the chain is still loading.
 */
export function computeRollEconomicsMid(
  spread: ActiveSpread,
  newShortStrike: number,
  newLongStrike: number,
  newRight: "P" | "C",
  newQuotes: Map<string, ChainQuote>,
  currentQuotes: Map<string, ChainQuote>,
): RollEconomics {
  // Current spread: identify short and long legs.
  const shortLeg = spread.legs.find(l => l.side === "SELL");
  const longLeg = spread.legs.find(l => l.side === "BUY");
  const closeShortMid = shortLeg ? currentQuotes.get(`${shortLeg.strike}:${shortLeg.right}`)?.mid ?? 0 : 0;
  const closeLongMid = longLeg ? currentQuotes.get(`${longLeg.strike}:${longLeg.right}`)?.mid ?? 0 : 0;
  // Closing the credit spread: buy back short, sell out the long → debit = shortMid - longMid.
  const closeDebitMid = Math.max(0, closeShortMid - closeLongMid);

  const newShortMid = newQuotes.get(`${newShortStrike}:${newRight}`)?.mid ?? 0;
  const newLongMid = newQuotes.get(`${newLongStrike}:${newRight}`)?.mid ?? 0;
  // Opening a new credit spread: sell short, buy long → credit = newShortMid - newLongMid.
  const openCreditMid = Math.max(0, newShortMid - newLongMid);

  return {
    closeDebitMid,
    openCreditMid,
    netDebitMid: closeDebitMid - openCreditMid,
  };
}

/** Build close-combo legs (each side flipped) from an existing spread, suitable for `api.ironCondor.closeSpread`. */
export function buildCloseLegs(spread: ActiveSpread): IronCondorOrderLeg[] {
  return spread.legs.map(leg => ({
    conId: leg.conId,
    strike: leg.strike,
    type: leg.right === "P" ? "PUT" : "CALL",
    side: leg.side === "SELL" ? "BUY" : "SELL",
    expiration: spread.expiry,
    exchange: leg.exchange,
  }));
}

/** Build open-combo legs for the new spread: SELL new short + BUY new long. */
export function buildOpenLegs(
  newShortStrike: number,
  newLongStrike: number,
  newShortConId: number,
  newLongConId: number,
  newRight: "P" | "C",
  targetExpiration: string,
): IronCondorOrderLeg[] {
  return [
    {
      conId: newShortConId,
      strike: newShortStrike,
      type: newRight === "P" ? "PUT" : "CALL",
      side: "SELL",
      expiration: targetExpiration,
      exchange: "SMART",
    },
    {
      conId: newLongConId,
      strike: newLongStrike,
      type: newRight === "P" ? "PUT" : "CALL",
      side: "BUY",
      expiration: targetExpiration,
      exchange: "SMART",
    },
  ];
}

export interface PayoffSummary {
  maxLoss: number;    // negative number for losses, expressed as total dollars
  maxProfit: number;  // positive number for profits
  breakeven: number;  // underlying price where position breaks even
}

/**
 * Before-state summary for the existing credit spread.
 * Max loss = (wing width - net credit/contract) * 100 * quantity.
 * Max profit = net credit per contract * 100 * quantity (full credit kept).
 * Breakeven (call spread) = shortStrike + creditPerContract.
 * Breakeven (put spread)  = shortStrike - creditPerContract.
 */
export function summarizeExisting(spread: ActiveSpread): PayoffSummary {
  const qty = Math.max(1, Math.round(spread.quantity));
  const creditPerContract = Math.abs(spread.netPremium) / (qty * 100);
  const wing = deriveWingWidth(spread);
  const isPut = spread.legs.some(l => l.right === "P" && l.side === "SELL");
  const shortStrike = spread.legs.find(l => l.side === "SELL")?.strike ?? 0;
  const maxProfit = creditPerContract * 100 * qty;
  const maxLoss = -1 * (wing - creditPerContract) * 100 * qty;
  const breakeven = isPut ? shortStrike - creditPerContract : shortStrike + creditPerContract;
  return { maxLoss, maxProfit, breakeven };
}

/**
 * After-state summary for the new credit spread that would replace the existing one.
 * Uses `openCreditPerContract` (the limit credit user enters for the open leg)
 * minus `closeDebitPerContract` (the cost paid to close the existing spread)
 * plus the realized P&L already locked in by the close — but for simplicity we
 * report the new spread's payoff in isolation; the dialog also shows the
 * net roll debit separately so the user sees both numbers.
 */
export function summarizeNewSpread(
  newShortStrike: number,
  newLongStrike: number,
  isPut: boolean,
  newCreditPerContract: number,
  quantity: number,
): PayoffSummary {
  const wing = Math.abs(newShortStrike - newLongStrike);
  const maxProfit = newCreditPerContract * 100 * quantity;
  const maxLoss = -1 * (wing - newCreditPerContract) * 100 * quantity;
  const breakeven = isPut ? newShortStrike - newCreditPerContract : newShortStrike + newCreditPerContract;
  return { maxLoss, maxProfit, breakeven };
}

// ---------------------------------------------------------------------------
// Display helpers (used by RollOutDialog UI)
// ---------------------------------------------------------------------------

/** Format a YYYYMMDD expiration as e.g. "Apr 18 (3 DTE)". Falls back to raw on bad input. */
export function formatExpiry(expiry: string): string {
  if (expiry.length !== 8) return expiry;
  const d = new Date(parseInt(expiry.slice(0, 4)), parseInt(expiry.slice(4, 6)) - 1, parseInt(expiry.slice(6, 8)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
}

/**
 * Format a number as a currency string, e.g. 12.5 → "$12.50".
 * `null` renders as "—". With `opts.sign === true`, positive values get a leading "+",
 * negative values get a leading "-", zero renders without a sign.
 */
export function fmtCurrency(value: number | null, opts?: { sign?: boolean }): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (opts?.sign) {
    if (value > 0) return `+${formatted}`;
    if (value < 0) return `-${formatted}`;
    return formatted;
  }
  return value < 0 ? `-${formatted}` : formatted;
}
