/**
 * Groups flat option positions into spreads (put spreads, call spreads, iron condors)
 * based on matching underlying, expiry, right, and opposite position signs.
 */

import type { Position, CurrentOptionPosition } from "@assup/shared";

export type SpreadType = "put-spread" | "call-spread" | "iron-condor";

export interface PositionSpreadGroup {
  type: SpreadType;
  underlying: string;
  expiry: string;
  legs: Position[];
  quantity: number;
  totalMarketValue: number;
  totalPnl: number | null;
  totalCostBasis: number;
  totalAvgCost: number;
}

export interface OpenPositionSpreadGroup {
  type: SpreadType;
  underlying: string;
  expiry: string;
  legs: CurrentOptionPosition[];
  quantity: number;
  totalUnrealizedPnl: number;
  maxProfit: number;
  totalMarketValue: number;
  underlyingPrice?: number;
  assetClassId?: string;
  assetClassName?: string;
  assetClassColor?: string;
}

/** Pair legs of the same right (put or call) into verticals */
function pairLegs<T>(
  positions: T[],
  getQty: (p: T) => number,
  getStrike: (p: T) => number,
): { paired: T[][]; unpaired: T[] } {
  const sorted = [...positions].sort((a, b) => getStrike(a) - getStrike(b));
  const used = new Set<number>();
  const paired: T[][] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const qi = getQty(sorted[i]);
      const qj = getQty(sorted[j]);
      // One short, one long, same absolute quantity
      if (qi * qj < 0 && Math.abs(qi) === Math.abs(qj)) {
        paired.push([sorted[i], sorted[j]]);
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  const unpaired = sorted.filter((_, i) => !used.has(i));
  return { paired, unpaired };
}

export function groupPositionsIntoSpreads(positions: Position[]): {
  spreads: PositionSpreadGroup[];
  ungrouped: Position[];
} {
  const byKey = new Map<string, Position[]>();
  const noGroup: Position[] = [];

  for (const pos of positions) {
    if (!pos.underlying || !pos.expiry || !pos.right || pos.strike == null) {
      noGroup.push(pos);
      continue;
    }
    const key = `${pos.underlying}:${pos.expiry}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(pos);
  }

  const spreads: PositionSpreadGroup[] = [];
  const ungrouped: Position[] = [...noGroup];

  for (const [, group] of byKey) {
    const puts = group.filter(p => p.right === "P");
    const calls = group.filter(p => p.right === "C");

    const { paired: putPairs, unpaired: putUnpaired } = pairLegs(
      puts, p => p.position, p => p.strike ?? 0,
    );
    const { paired: callPairs, unpaired: callUnpaired } = pairLegs(
      calls, p => p.position, p => p.strike ?? 0,
    );

    // Try to form iron condors from matching put+call pairs
    const usedPuts = new Set<number>();
    const usedCalls = new Set<number>();

    for (let pi = 0; pi < putPairs.length; pi++) {
      for (let ci = 0; ci < callPairs.length; ci++) {
        if (usedPuts.has(pi) || usedCalls.has(ci)) continue;
        if (Math.abs(putPairs[pi][0].position) === Math.abs(callPairs[ci][0].position)) {
          const legs = [...putPairs[pi], ...callPairs[ci]].sort(
            (a, b) => (a.strike ?? 0) - (b.strike ?? 0),
          );
          spreads.push(makePositionSpreadGroup("iron-condor", legs));
          usedPuts.add(pi);
          usedCalls.add(ci);
        }
      }
    }

    for (let i = 0; i < putPairs.length; i++) {
      if (usedPuts.has(i)) continue;
      const legs = putPairs[i].sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
      spreads.push(makePositionSpreadGroup("put-spread", legs));
    }

    for (let i = 0; i < callPairs.length; i++) {
      if (usedCalls.has(i)) continue;
      const legs = callPairs[i].sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
      spreads.push(makePositionSpreadGroup("call-spread", legs));
    }

    ungrouped.push(...putUnpaired, ...callUnpaired);
  }

  return { spreads, ungrouped };
}

function makePositionSpreadGroup(type: SpreadType, legs: Position[]): PositionSpreadGroup {
  return {
    type,
    underlying: legs[0].underlying!,
    expiry: legs[0].expiry!,
    legs,
    quantity: Math.abs(legs[0].position),
    totalMarketValue: legs.reduce((s, l) => s + (l.marketValue ?? 0), 0),
    totalPnl: legs.some(l => l.unrealizedPnl == null)
      ? null
      : legs.reduce((s, l) => s + (l.unrealizedPnl ?? 0), 0),
    totalCostBasis: legs.reduce((s, l) => s + l.costBasis, 0),
    totalAvgCost: legs.reduce((s, l) => s + l.avgCost, 0),
  };
}

export function groupOpenPositionsIntoSpreads(positions: CurrentOptionPosition[]): {
  spreads: OpenPositionSpreadGroup[];
  ungrouped: CurrentOptionPosition[];
} {
  const byKey = new Map<string, CurrentOptionPosition[]>();

  for (const pos of positions) {
    const key = `${pos.underlying}:${pos.expiry}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(pos);
  }

  const spreads: OpenPositionSpreadGroup[] = [];
  const ungrouped: CurrentOptionPosition[] = [];

  for (const [, group] of byKey) {
    const puts = group.filter(p => p.right === "P");
    const calls = group.filter(p => p.right === "C");

    const { paired: putPairs, unpaired: putUnpaired } = pairLegs(
      puts, p => p.quantity, p => p.strike,
    );
    const { paired: callPairs, unpaired: callUnpaired } = pairLegs(
      calls, p => p.quantity, p => p.strike,
    );

    const usedPuts = new Set<number>();
    const usedCalls = new Set<number>();

    for (let pi = 0; pi < putPairs.length; pi++) {
      for (let ci = 0; ci < callPairs.length; ci++) {
        if (usedPuts.has(pi) || usedCalls.has(ci)) continue;
        if (Math.abs(putPairs[pi][0].quantity) === Math.abs(callPairs[ci][0].quantity)) {
          const legs = [...putPairs[pi], ...callPairs[ci]].sort(
            (a, b) => a.strike - b.strike,
          );
          spreads.push(makeOpenSpreadGroup("iron-condor", legs));
          usedPuts.add(pi);
          usedCalls.add(ci);
        }
      }
    }

    for (let i = 0; i < putPairs.length; i++) {
      if (usedPuts.has(i)) continue;
      const legs = putPairs[i].sort((a, b) => a.strike - b.strike);
      spreads.push(makeOpenSpreadGroup("put-spread", legs));
    }

    for (let i = 0; i < callPairs.length; i++) {
      if (usedCalls.has(i)) continue;
      const legs = callPairs[i].sort((a, b) => a.strike - b.strike);
      spreads.push(makeOpenSpreadGroup("call-spread", legs));
    }

    ungrouped.push(...putUnpaired, ...callUnpaired);
  }

  return { spreads, ungrouped };
}

function makeOpenSpreadGroup(type: SpreadType, legs: CurrentOptionPosition[]): OpenPositionSpreadGroup {
  const first = legs[0];
  return {
    type,
    underlying: first.underlying,
    expiry: first.expiry,
    legs,
    quantity: Math.abs(first.quantity),
    totalUnrealizedPnl: legs.reduce((s, l) => s + l.unrealizedPnl, 0),
    // Max profit = net credit received: short legs (qty<0) add, long legs (qty>0) subtract
    // avgCost from IBKR already includes the multiplier (per contract, not per share)
    maxProfit: legs.reduce((s, l) => s + l.avgCost * -l.quantity, 0),
    totalMarketValue: legs.reduce((s, l) => s + l.marketValue, 0),
    underlyingPrice: first.underlyingPrice,
    assetClassId: first.assetClassId,
    assetClassName: first.assetClassName,
    assetClassColor: first.assetClassColor,
  };
}

/** Format a display name for a grouped spread */
export function formatLiveSpreadName(type: SpreadType, underlying: string, legs: { strike?: number }[]): string {
  const strikes = legs.map(l => l.strike ?? 0).sort((a, b) => a - b);
  const fmtStrike = (s: number) => s % 1 === 0 ? s.toString() : s.toFixed(2);
  switch (type) {
    case "put-spread":
      return `${underlying} ${fmtStrike(strikes[1])}/${fmtStrike(strikes[0])} Put Spread`;
    case "call-spread":
      return `${underlying} ${fmtStrike(strikes[0])}/${fmtStrike(strikes[1])} Call Spread`;
    case "iron-condor":
      return `${underlying} ${strikes.map(fmtStrike).join("/")} IC`;
  }
}

export function spreadTypeBadgeProps(type: SpreadType): { label: string; className: string } {
  switch (type) {
    case "put-spread": return { label: "PS", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" };
    case "call-spread": return { label: "CS", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" };
    case "iron-condor": return { label: "IC", className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" };
  }
}
