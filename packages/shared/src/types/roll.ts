/**
 * Types for the Roll Option feature.
 * A roll is a BUY-to-close + SELL-to-open combo order moving a short option
 * to a higher strike (calls) or lower strike (puts) and further expiry.
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
  /** Mid-based net credit: candidate.mid − close.mid (used for sorting/filtering) */
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
  openConId: number;
  quantity: number;
  /** Positive net credit from user's perspective; backend negates for IBKR convention */
  limitPrice: number;
}
