/**
 * Spread grouping service — post-processes OptionTradeGroup[] into SpreadTradeGroup[]
 *
 * Identifies credit put spreads, credit call spreads, and iron condors by matching
 * short + long legs that share the same underlying, expiry, quantity, and were opened
 * within 1 calendar day of each other.
 */

import type {
  OptionTradeGroup,
  SpreadTradeGroup,
  SpreadStatus,
} from "@assup/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the open date from a group (ISO string or null). Falls back to close date. */
export function getOpenDate(g: OptionTradeGroup): string | null {
  return g.openTrade?.tradeDate ?? g.closeTrade?.tradeDate ?? null;
}

/** Extract effective quantity (prefer open, fall back to close). */
export function getQuantity(g: OptionTradeGroup): number {
  return g.openTrade?.quantity ?? g.closeTrade?.quantity ?? 0;
}

/**
 * Determine the opening side of a trade group.
 * Uses openTrade.buySell if available; otherwise infers from closeTrade
 * (a BUY-to-close means it was originally SELL-to-open, and vice versa).
 */
function getOpenSide(g: OptionTradeGroup): "SELL" | "BUY" | null {
  if (g.openTrade?.buySell) return g.openTrade.buySell as "SELL" | "BUY";
  // Infer from close trade (opposite direction)
  if (g.closeTrade?.buySell === "BUY") return "SELL";
  if (g.closeTrade?.buySell === "SELL") return "BUY";
  return null;
}

/** Check whether two ISO-date strings are within 1 calendar day (86 400 000 ms). */
export function withinOneDay(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const diff = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return diff <= 86_400_000;
}

/** Derive the spread status from legs. */
export function getStatus(legs: OptionTradeGroup[]): SpreadStatus {
  const allExpired = legs.every((l) => l.expiredWorthless);
  if (allExpired) return "expired";

  const allClosed = legs.every((l) => l.closeTrade != null && !l.expiredWorthless);
  if (allClosed) return "closed";

  return "partial";
}

/** Sum commissions across all legs (open + close). */
function sumCommissions(legs: OptionTradeGroup[]): number {
  let total = 0;
  for (const leg of legs) {
    if (leg.openTrade) total += leg.openTrade.commission;
    if (leg.closeTrade) total += leg.closeTrade.commission;
  }
  return total;
}

/** Build a SpreadTradeGroup from its constituent legs. */
export function buildSpread(
  type: SpreadTradeGroup["type"],
  legs: OptionTradeGroup[],
): SpreadTradeGroup {
  // Net premium received (max profit): short legs add credit, long legs subtract debit
  const costBasis = legs.reduce((s, l) => {
    const side = getOpenSide(l);
    return side === "SELL" ? s + l.costBasis : s - l.costBasis;
  }, 0);
  // Net cost to close: short legs add cost, long legs subtract proceeds
  const sellPrice = legs.reduce((s, l) => {
    const side = getOpenSide(l);
    return side === "SELL" ? s + l.sellPrice : s - l.sellPrice;
  }, 0);
  const profit = legs.reduce((s, l) => s + l.profit, 0);
  const commissions = sumCommissions(legs);

  // Earliest open date across legs
  const openDates = legs
    .map((l) => getOpenDate(l))
    .filter((d): d is string => d !== null);
  const openDate =
    openDates.length > 0
      ? openDates.sort()[0]
      : legs[0].expiry; // fallback

  // Latest close / expiry date across legs
  const closeDates = legs
    .map((l) => l.closeTrade?.tradeDate ?? (l.expiredWorthless ? l.expiry : null))
    .filter((d): d is string => d !== null);
  const closeDate =
    closeDates.length > 0
      ? closeDates.sort().reverse()[0]
      : null;

  // Inherit asset class from the short leg (first leg by convention)
  const shortLeg = legs.find((l) => l.openTrade?.buySell === "SELL") ?? legs[0];

  return {
    type,
    underlying: legs[0].underlying,
    expiry: legs[0].expiry,
    quantity: getQuantity(legs[0]),
    legs,
    costBasis,
    sellPrice,
    profit,
    commissions,
    status: getStatus(legs),
    openDate,
    closeDate,
    assetClassId: shortLeg.assetClassId,
    assetClassName: shortLeg.assetClassName,
    assetClassColor: shortLeg.assetClassColor,
  };
}

// ---------------------------------------------------------------------------
// Core matching
// ---------------------------------------------------------------------------

interface CreditSpread {
  type: "put-spread" | "call-spread";
  shortLeg: OptionTradeGroup;
  longLeg: OptionTradeGroup;
}

/**
 * Try to find credit spreads among a list of groups that share the same
 * underlying and expiry.  Returns matched spreads and any leftovers.
 */
function matchCreditSpreads(
  groups: OptionTradeGroup[],
): { spreads: CreditSpread[]; leftover: OptionTradeGroup[] } {
  const spreads: CreditSpread[] = [];
  const used = new Set<number>();

  // Separate into short (SELL to open) and long (BUY to open)
  // Uses getOpenSide() which infers from closeTrade if openTrade is missing
  const shorts = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => getOpenSide(g) === "SELL");
  const longs = groups
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => getOpenSide(g) === "BUY");

  for (const s of shorts) {
    if (used.has(s.i)) continue;

    for (const l of longs) {
      if (used.has(l.i)) continue;
      if (s.g.right !== l.g.right) continue;
      if (getQuantity(s.g) !== getQuantity(l.g)) continue;
      if (!withinOneDay(getOpenDate(s.g), getOpenDate(l.g))) continue;

      // Validate strike relationship
      if (s.g.right === "P") {
        // Credit put spread: short (higher strike) + long (lower strike)
        if (s.g.strike <= l.g.strike) continue;
        spreads.push({ type: "put-spread", shortLeg: s.g, longLeg: l.g });
      } else {
        // Credit call spread: short (lower strike) + long (higher strike)
        if (s.g.strike >= l.g.strike) continue;
        spreads.push({ type: "call-spread", shortLeg: s.g, longLeg: l.g });
      }

      used.add(s.i);
      used.add(l.i);
      break; // move on to the next short
    }
  }

  const leftover = groups.filter((_, i) => !used.has(i));
  return { spreads, leftover };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Groups OptionTradeGroup[] into SpreadTradeGroup[] for credit spreads and
 * iron condors.  Only considers groups whose `underlying` appears in
 * `eligibleSymbols`.  Everything that cannot be matched is returned in
 * `remaining`.
 */
export function groupSpreads(
  groups: OptionTradeGroup[],
  eligibleSymbols: string[],
): { spreads: SpreadTradeGroup[]; remaining: OptionTradeGroup[] } {
  const eligibleSet = new Set(eligibleSymbols);

  // Partition into eligible vs non-eligible
  const eligible: OptionTradeGroup[] = [];
  const nonEligible: OptionTradeGroup[] = [];
  for (const g of groups) {
    if (eligibleSet.has(g.underlying)) {
      eligible.push(g);
    } else {
      nonEligible.push(g);
    }
  }

  // Bucket eligible groups by (underlying, expiry)
  const buckets = new Map<string, OptionTradeGroup[]>();
  for (const g of eligible) {
    const key = `${g.underlying}|${g.expiry}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(g);
  }

  const allPutSpreads: CreditSpread[] = [];
  const allCallSpreads: CreditSpread[] = [];
  const leftoverGroups: OptionTradeGroup[] = [];

  for (const [, bucket] of buckets) {
    const { spreads, leftover } = matchCreditSpreads(bucket);
    for (const sp of spreads) {
      if (sp.type === "put-spread") allPutSpreads.push(sp);
      else allCallSpreads.push(sp);
    }
    leftoverGroups.push(...leftover);
  }

  // Step 1: Try to form iron condors (put spread + call spread, same underlying/expiry/qty)
  const result: SpreadTradeGroup[] = [];
  const usedPut = new Set<number>();
  const usedCall = new Set<number>();

  for (let pi = 0; pi < allPutSpreads.length; pi++) {
    if (usedPut.has(pi)) continue;
    const ps = allPutSpreads[pi];

    for (let ci = 0; ci < allCallSpreads.length; ci++) {
      if (usedCall.has(ci)) continue;
      const cs = allCallSpreads[ci];

      if (ps.shortLeg.underlying !== cs.shortLeg.underlying) continue;
      if (ps.shortLeg.expiry !== cs.shortLeg.expiry) continue;
      if (getQuantity(ps.shortLeg) !== getQuantity(cs.shortLeg)) continue;

      // Match — build iron condor
      const legs = [ps.shortLeg, ps.longLeg, cs.shortLeg, cs.longLeg];
      result.push(buildSpread("iron-condor", legs));
      usedPut.add(pi);
      usedCall.add(ci);
      break;
    }
  }

  // Step 2: Remaining put spreads
  for (let pi = 0; pi < allPutSpreads.length; pi++) {
    if (usedPut.has(pi)) continue;
    const ps = allPutSpreads[pi];
    result.push(buildSpread("put-spread", [ps.shortLeg, ps.longLeg]));
  }

  // Step 3: Remaining call spreads
  for (let ci = 0; ci < allCallSpreads.length; ci++) {
    if (usedCall.has(ci)) continue;
    const cs = allCallSpreads[ci];
    result.push(buildSpread("call-spread", [cs.shortLeg, cs.longLeg]));
  }

  // Step 4: Everything else goes to remaining
  const remaining = [...nonEligible, ...leftoverGroups];

  return { spreads: result, remaining };
}
