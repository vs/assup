/**
 * Types for the Roll Option feature.
 * A roll is a BUY-to-close + SELL-to-open combo order moving a short option to
 * a later expiry, at any strike within a band around the current one. Rolls
 * that cost money (a debit) are offered too, marked by a negative net credit.
 */

export interface RollCandidatesRequest {
  symbol: string;
  /** Current option expiry in YYYYMMDD format */
  expiration: string;
  strike: number;
  right: "C" | "P";
  /** IBKR contract ID of the current position (used to fetch close-leg prices) */
  conId: number;
  /** Candidates must expire at least this many days after the current expiry (default 30) */
  minDTEBeyond: number;
  /** Strike band around the current strike, in percent, both directions (default 20) */
  strikeRangePercent: number;
  /** SSE client id to send RollScanProgress events to while the scan runs */
  progressClientId?: string;
  /** Echoed back in progress events so a dialog only reads its own scan */
  scanId?: string;
}

/** Phases of a roll scan, reported over SSE while it runs */
export type RollScanPhase = "close-leg" | "chain" | "contracts" | "quotes" | "done";

export interface RollScanProgress {
  /** Identifies which dialog's scan this belongs to */
  scanId: string;
  phase: RollScanPhase;
  /** Human-readable status line, e.g. "Quoting 34 contracts" */
  message: string;
  /** Completed units within the phase (contracts quoted, expiries looked up) */
  done?: number;
  total?: number;
}

export interface RollCandidate {
  conId: number;
  strike: number;
  /** Expiry in YYYYMMDD format */
  expiration: string;
  daysToExpiry: number;
  bid: number;
  ask: number;
  mid: number;
  /** Conservative net credit: candidate.bid − close.ask */
  netCredit: number;
  /** Mid-based net credit: candidate.mid − close.mid (negative = debit roll) */
  netCreditMid: number;
  annualizedReturn: number;
}

export interface RollCandidatesResponse {
  closeLeg: { conId: number; bid: number; ask: number; mid: number };
  candidates: RollCandidate[];
}

export interface RollOrderRequest {
  symbol: string;
  closeConId: number;
  /** IBKR conId for the new leg; 0 if not yet resolved (server resolves using open* fields) */
  openConId: number;
  /** Required when openConId is 0 so the server can resolve the contract */
  openExpiration: string;
  openStrike: number;
  openRight: "C" | "P";
  quantity: number;
  /** Net credit per contract from the user's perspective; negative = debit roll.
   *  The backend negates it for IBKR's combo convention. */
  limitPrice: number;
}
