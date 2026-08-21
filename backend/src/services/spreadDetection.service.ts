/**
 * Spread detection service.
 * Reconstructs spread/condor structures from individual IBKR option positions.
 * Considers option positions on any underlying.
 * Only returns fully matched spreads (2-leg credit spreads or 4-leg iron condors).
 */

import type { Position } from "@assup/shared";
import type { ActiveSpread, ActiveSpreadLeg, SpreadMode } from "@assup/shared";
import { SYMBOL_CONFIG as SHARED_SYMBOL_CONFIG, roundToTickSize } from "../utils/options.js";

function positionToLeg(p: Position): ActiveSpreadLeg {
  const multiplier = SHARED_SYMBOL_CONFIG[p.underlying ?? ""]?.multiplier ?? 100;
  const absPos = Math.abs(p.position);

  // midPrice: per-contract price. marketValue is always positive (absolute) from position service.
  // For short legs: closing cost = +marketValue / (absPos * multiplier) (you pay this)
  // For long legs: closing proceeds = -marketValue / (absPos * multiplier) (you receive this)
  let midPrice: number | null = null;
  if (p.marketValue != null && absPos > 0) {
    const perContract = p.marketValue / (absPos * multiplier);
    midPrice = p.position < 0 ? perContract : -perContract;
  }

  return {
    conId: p.conId,
    strike: p.strike ?? 0,
    right: (p.right ?? "P") as "P" | "C",
    side: p.position < 0 ? "SELL" : "BUY",
    position: p.position,
    avgCost: p.avgCost,
    marketValue: p.marketValue,
    unrealizedPnl: p.unrealizedPnl,
    midPrice,
    exchange: p.exchange || "SMART",
  };
}

function makeSpreadId(legs: ActiveSpreadLeg[]): string {
  return legs.map(l => l.conId).sort((a, b) => a - b).join("-");
}

interface LegPool {
  shortPuts: ActiveSpreadLeg[];
  longPuts: ActiveSpreadLeg[];
  shortCalls: ActiveSpreadLeg[];
  longCalls: ActiveSpreadLeg[];
}

function classifyLegs(legs: ActiveSpreadLeg[]): LegPool {
  const pool: LegPool = { shortPuts: [], longPuts: [], shortCalls: [], longCalls: [] };
  for (const leg of legs) {
    if (leg.right === "P" && leg.side === "SELL") pool.shortPuts.push(leg);
    else if (leg.right === "P" && leg.side === "BUY") pool.longPuts.push(leg);
    else if (leg.right === "C" && leg.side === "SELL") pool.shortCalls.push(leg);
    else if (leg.right === "C" && leg.side === "BUY") pool.longCalls.push(leg);
  }
  // Sort by strike for pairing
  pool.shortPuts.sort((a, b) => a.strike - b.strike);
  pool.longPuts.sort((a, b) => a.strike - b.strike);
  pool.shortCalls.sort((a, b) => a.strike - b.strike);
  pool.longCalls.sort((a, b) => a.strike - b.strike);
  return pool;
}

function tryMatchPutSpread(pool: LegPool): { short: ActiveSpreadLeg; long: ActiveSpreadLeg } | null {
  for (let si = 0; si < pool.shortPuts.length; si++) {
    const sp = pool.shortPuts[si];
    for (let li = 0; li < pool.longPuts.length; li++) {
      const lp = pool.longPuts[li];
      // Credit put spread: long strike < short strike, same quantity
      if (lp.strike < sp.strike && Math.abs(lp.position) === Math.abs(sp.position)) {
        pool.shortPuts.splice(si, 1);
        pool.longPuts.splice(li, 1);
        return { short: sp, long: lp };
      }
    }
  }
  return null;
}

function tryMatchCallSpread(pool: LegPool): { short: ActiveSpreadLeg; long: ActiveSpreadLeg } | null {
  for (let si = 0; si < pool.shortCalls.length; si++) {
    const sc = pool.shortCalls[si];
    for (let li = 0; li < pool.longCalls.length; li++) {
      const lc = pool.longCalls[li];
      // Credit call spread: short strike < long strike, same quantity
      if (sc.strike < lc.strike && Math.abs(lc.position) === Math.abs(sc.position)) {
        pool.shortCalls.splice(si, 1);
        pool.longCalls.splice(li, 1);
        return { short: sc, long: lc };
      }
    }
  }
  return null;
}

function buildSpread(
  type: SpreadMode,
  symbol: string,
  expiry: string,
  legs: ActiveSpreadLeg[],
): ActiveSpread {
  const quantity = Math.abs(legs[0].position);
  const totalPnl = legs.every(l => l.unrealizedPnl != null)
    ? legs.reduce((sum, l) => sum + (l.unrealizedPnl ?? 0), 0)
    : null;
  const netPremium = legs.reduce((sum, l) => sum + l.avgCost * l.position, 0);
  const closeMidPriceRaw = legs.every(l => l.midPrice != null)
    ? legs.reduce((sum, l) => sum + (l.midPrice ?? 0), 0)
    : null;
  const tickSize = SHARED_SYMBOL_CONFIG[symbol]?.comboTickSize ?? 0.01;
  const closeMidPrice = closeMidPriceRaw != null ? roundToTickSize(closeMidPriceRaw, tickSize) : null;

  return {
    id: makeSpreadId(legs),
    type,
    symbol,
    expiry,
    quantity,
    legs,
    totalPnl: totalPnl != null ? Math.round(totalPnl * 100) / 100 : null,
    netPremium: Math.round(netPremium * 100) / 100,
    closeMidPrice,
    orphanLegs: [],
  };
}

/**
 * Group IBKR positions into recognized spread structures.
 * Considers option positions on any underlying.
 * Only returns fully matched spreads — unmatched legs are silently ignored.
 */
export function groupIntoSpreads(positions: Position[]): ActiveSpread[] {
  // 1. Filter to option positions with required fields
  const optionPositions = positions.filter(
    p => p.secType === "OPT"
      && p.underlying
      && p.expiry
      && p.strike != null
      && p.right
  );

  // 2. Group by underlying + expiry
  const groups = new Map<string, Position[]>();
  for (const p of optionPositions) {
    const key = `${p.underlying}:${p.expiry}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const results: ActiveSpread[] = [];

  for (const [, groupPositions] of groups) {
    const symbol = groupPositions[0].underlying!;
    const expiry = groupPositions[0].expiry!;
    const allLegs = groupPositions.map(positionToLeg);
    const pool = classifyLegs(allLegs);

    // 3. Try iron condors first (put spread + call spread with same qty)
    let putMatch = tryMatchPutSpread(pool);
    while (putMatch) {
      const callMatch = tryMatchCallSpread(pool);
      if (callMatch && Math.abs(putMatch.short.position) === Math.abs(callMatch.short.position)) {
        // Iron condor
        results.push(buildSpread(
          "iron-condor", symbol, expiry,
          [putMatch.long, putMatch.short, callMatch.short, callMatch.long],
        ));
      } else {
        // Only a put spread (put back the call if we took one)
        if (callMatch) {
          pool.shortCalls.push(callMatch.short);
          pool.longCalls.push(callMatch.long);
          pool.shortCalls.sort((a, b) => a.strike - b.strike);
          pool.longCalls.sort((a, b) => a.strike - b.strike);
        }
        results.push(buildSpread("put-spread", symbol, expiry, [putMatch.long, putMatch.short]));
      }
      putMatch = tryMatchPutSpread(pool);
    }

    // 4. Remaining call spreads
    let callMatch = tryMatchCallSpread(pool);
    while (callMatch) {
      results.push(buildSpread("call-spread", symbol, expiry, [callMatch.short, callMatch.long]));
      callMatch = tryMatchCallSpread(pool);
    }

    // Unmatched legs are silently dropped — they don't form valid spreads
  }

  return results;
}
