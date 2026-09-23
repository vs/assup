/**
 * Types shared by the QuoteHub and its consumers.
 */

/**
 * Why a quote has (or lacks) data:
 * - ok: every requested field arrived
 * - pending: subscribed, still waiting for ticks
 * - no-market: TWS reported no bid/ask (-1) for a requested price
 * - timeout: requested fields didn't all arrive before the deadline
 * - no-contract: TWS error 200 (unknown conId / unlisted strike)
 * - not-subscribed: account lacks market data permissions for the contract
 * - no-lines: no market data line was available
 * - error: any other TWS error (see Quote.error)
 */
export type QuoteStatus =
  | "ok"
  | "pending"
  | "no-market"
  | "timeout"
  | "no-contract"
  | "not-subscribed"
  | "no-lines"
  | "error";

/** Fields a caller can wait for. `price` is last, falling back to close. */
export type QuoteField =
  | "bid"
  | "ask"
  | "last"
  | "close"
  | "open"
  | "volume"
  | "price"
  | "delta"
  | "theta"
  | "iv"
  | "undPrice";

export interface Quote {
  key: string;
  status: QuoteStatus;
  bid?: number;
  ask?: number;
  last?: number;
  close?: number;
  open?: number;
  volume?: number;
  /** Model option delta, signed as TWS reports it (negative for puts) */
  delta?: number;
  /** Model daily theta per share */
  theta?: number;
  /** Model implied volatility as a fraction (0.52 = 52%) */
  iv?: number;
  /** Underlying price TWS used for the option model */
  undPrice?: number;
  /** Price fields TWS reported as "no market" (-1) */
  noMarket?: Array<"bid" | "ask">;
  /** Epoch ms of the last tick, null before the first */
  updatedAt: number | null;
  /** TWS error message when status is an error status */
  error?: string;
}

/**
 * A contract as consumers describe it. Pass `conId` whenever you have one:
 * conId-keyed subscriptions are shared by every consumer of that contract.
 */
export interface QuoteContract {
  conId?: number;
  symbol?: string;
  secType: string;
  exchange?: string;
  currency?: string;
  lastTradeDateOrContractMonth?: string;
  strike?: number;
  right?: string;
  multiplier?: number | string;
  tradingClass?: string;
}
