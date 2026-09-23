/**
 * Canonical contract keys and TWS tick decoding for the QuoteHub.
 *
 * @stoqey/ib shares a TWS subscription only between byte-identical requests
 * (it keys by JSON.stringify(contract)), so the hub sends one canonical
 * contract per key: `{ conId, exchange }` when a conId is known.
 */

import type { Contract } from "@stoqey/ib";
import type { Quote, QuoteContract, QuoteField, QuoteStatus } from "./quoteTypes.js";

function normalizeRight(right: string | undefined): string {
  if (!right) return "";
  const r = right.toUpperCase();
  if (r === "PUT" || r === "P") return "P";
  if (r === "CALL" || r === "C") return "C";
  return r;
}

/** Stable key for a contract: `conId:<id>` or `spec:<secType>:<symbol>:<expiry>:<strike>:<right>:<tradingClass>:<multiplier>` */
export function quoteKey(c: QuoteContract): string {
  if (c.conId) return `conId:${c.conId}`;
  return [
    "spec",
    c.secType,
    c.symbol ?? "",
    c.lastTradeDateOrContractMonth ?? "",
    c.strike ?? "",
    normalizeRight(c.right),
    c.tradingClass ?? "",
    c.multiplier != null ? Number(c.multiplier) : "",
  ].join(":");
}

/**
 * The contract actually sent to TWS. Options and stocks route through SMART;
 * indexes keep their listing exchange (SPX on SMART fails with error 200).
 */
export function subscribeContract(c: QuoteContract): Contract {
  const exchange = c.secType === "IND" ? (c.exchange ?? "CBOE") : "SMART";
  if (c.conId) return { conId: c.conId, exchange };

  const contract: Record<string, unknown> = {
    symbol: c.symbol,
    secType: c.secType,
    exchange,
    currency: c.currency ?? "USD",
  };
  if (c.lastTradeDateOrContractMonth) contract.lastTradeDateOrContractMonth = c.lastTradeDateOrContractMonth;
  if (c.strike != null) contract.strike = c.strike;
  if (c.right) contract.right = normalizeRight(c.right);
  if (c.multiplier != null) contract.multiplier = Number(c.multiplier);
  if (c.tradingClass) contract.tradingClass = c.tradingClass;
  return contract as Contract;
}

type Ticks = ReadonlyMap<number, { value?: number }>;

/** First defined numeric value among tick ids, in priority order (live before delayed) */
function pick(all: Ticks, ...ids: number[]): number | undefined {
  for (const id of ids) {
    const v = all.get(id)?.value;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return undefined;
}

function setNoMarket(q: Quote, field: "bid" | "ask", noMarket: boolean): void {
  const set = new Set(q.noMarket ?? []);
  if (noMarket) set.add(field);
  else set.delete(field);
  q.noMarket = [...set];
}

/**
 * Merge a TWS market data update into a quote. Ticks absent from the update
 * leave earlier values untouched. @stoqey/ib already turns greek "not
 * computed" sentinels into undefined; bid/ask -1 still means "no market".
 */
export function applyTicks(q: Quote, all: Ticks, now: number): void {
  for (const [field, live, delayed] of [["bid", 1, 66], ["ask", 2, 67]] as const) {
    const v = pick(all, live, delayed);
    if (v === undefined) continue;
    if (v < 0) {
      delete q[field];
      setNoMarket(q, field, true);
    } else {
      q[field] = v;
      setNoMarket(q, field, false);
    }
  }

  for (const [field, live, delayed] of [["last", 4, 68], ["close", 9, 75], ["open", 14, 76]] as const) {
    const v = pick(all, live, delayed);
    if (v !== undefined && v >= 0) q[field] = v;
  }

  const volume = pick(all, 8, 74);
  if (volume !== undefined && volume >= 0) q.volume = volume;

  // MODEL_OPTION_* first, then DELAYED_MODEL_*, then BID_OPTION_* computations
  const delta = pick(all, 10041, 10047, 10005, 10011);
  if (delta !== undefined) q.delta = delta;
  const theta = pick(all, 10044, 10050, 10008, 10014);
  if (theta !== undefined) q.theta = theta;
  const iv = pick(all, 10039, 10045, 10003, 10009);
  if (iv !== undefined) q.iv = iv;
  const undPrice = pick(all, 10002);
  if (undPrice !== undefined && undPrice > 0) q.undPrice = undPrice;

  q.updatedAt = now;
}

/** Last traded price, falling back to the previous close. Non-positive values don't count. */
export function quotePrice(q: Quote): number | undefined {
  if (q.last != null && q.last > 0) return q.last;
  if (q.close != null && q.close > 0) return q.close;
  return undefined;
}

export function hasField(q: Quote, f: QuoteField): boolean {
  if (f === "price") return quotePrice(q) !== undefined;
  return q[f] !== undefined;
}

export function statusForError(code: number | undefined): QuoteStatus {
  switch (code) {
    case 200:
      return "no-contract";
    case 354: // Requested market data is not subscribed
    case 10089: // Requested market data requires additional subscription (API)
    case 10091: // Part of requested market data requires additional subscription
      return "not-subscribed";
    case 101: // Max number of tickers has been reached
      return "no-lines";
    default:
      return "error";
  }
}
