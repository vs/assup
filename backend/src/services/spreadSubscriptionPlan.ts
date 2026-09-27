/**
 * Decides which option contracts a spread stream subscribes to.
 *
 * TWS hands out a fixed number of market data lines, so a session can only
 * stream a slice of the strike ladder. Picking that slice in ladder order
 * starves whatever sits at the top of it: an iron condor's focus regions span
 * both wings, and spending the lines on the lowest strikes first left the call
 * wing without a single line. So the budget is shared out between the focus
 * regions first, each region sampled end to end, and whatever is left over
 * goes to the rest of the ladder.
 */

import type { SpreadFocusRange } from "@assup/shared";

export type OptionSide = "P" | "C";

/** A region to cover densely, as the client asks for it. */
export type FocusRange = SpreadFocusRange;

/** A set of strikes to subscribe on the given sides. */
export interface SubscriptionGroup {
  sides: OptionSide[];
  strikes: number[];
}

export interface SubscriptionPlanInput {
  /** Every strike on the ladder, any order. */
  strikes: number[];
  /** Sides the spread mode needs: put-spread → ["P"], iron condor → ["P","C"]. */
  sides: OptionSide[];
  /** Option contracts that can be streamed (lines granted minus the underlying). */
  budget: number;
  /** Regions to cover densely. Without them the budget spreads over the ladder. */
  focusRanges?: FocusRange[];
}

export function plannedContractCount(groups: SubscriptionGroup[]): number {
  let n = 0;
  for (const g of groups) n += g.strikes.length * g.sides.length;
  return n;
}

/**
 * Pick `count` values spread evenly across `values`, keeping both ends.
 */
function sample(values: number[], count: number): number[] {
  if (count <= 0 || values.length === 0) return [];
  if (count >= values.length) return [...values];
  if (count === 1) return [values[0]];
  const step = (values.length - 1) / (count - 1);
  const picked: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step);
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(values[idx]);
  }
  return picked;
}

/**
 * Max-min fair split: every claimant gets an equal share, and a claimant that
 * wants less than its share leaves the rest to the others.
 */
function allocate(demands: number[], budget: number): number[] {
  const alloc = new Array<number>(demands.length).fill(0);
  let remaining = budget;
  let claimants = demands.length;
  const bySize = demands.map((_, i) => i).sort((a, b) => demands[a] - demands[b]);
  for (const i of bySize) {
    const share = Math.floor(remaining / claimants);
    alloc[i] = Math.min(demands[i], share);
    remaining -= alloc[i];
    claimants--;
  }
  // Rounding can leave a few contracts unspent — hand them to whoever still wants them.
  for (const i of bySize) {
    if (remaining <= 0) break;
    const want = Math.min(demands[i] - alloc[i], remaining);
    alloc[i] += want;
    remaining -= want;
  }
  return alloc;
}

export function planStrikeSubscriptions(input: SubscriptionPlanInput): SubscriptionGroup[] {
  const { sides, budget } = input;
  if (budget <= 0 || sides.length === 0) return [];

  const ladder = [...new Set(input.strikes)].sort((a, b) => a - b);
  if (ladder.length === 0) return [];

  const ranges = input.focusRanges ?? [];
  if (ranges.length === 0) {
    return groupOf(sides, sample(ladder, Math.floor(budget / sides.length)));
  }

  // A strike/side pair claimed by an earlier range is not claimed again, so
  // overlapping ranges don't pay for the same contract twice.
  const claimed = new Set<string>();
  const candidates = ranges.map((range) => {
    const rangeSides = range.sides ?? sides;
    const strikes = ladder.filter((s) => {
      if (s < range.min || s > range.max) return false;
      return rangeSides.some((side) => !claimed.has(`${s}:${side}`));
    });
    for (const s of strikes) for (const side of rangeSides) claimed.add(`${s}:${side}`);
    return { sides: rangeSides, strikes };
  });

  const allocation = allocate(
    candidates.map((c) => c.strikes.length * c.sides.length),
    budget,
  );

  const groups: SubscriptionGroup[] = [];
  let spent = 0;
  const planned = new Set<string>();
  candidates.forEach((candidate, i) => {
    const strikes = sample(
      candidate.strikes,
      Math.floor(allocation[i] / candidate.sides.length),
    );
    if (strikes.length === 0) return;
    groups.push({ sides: candidate.sides, strikes });
    spent += strikes.length * candidate.sides.length;
    for (const s of strikes) for (const side of candidate.sides) planned.add(`${s}:${side}`);
  });

  // Whatever the focus ranges didn't want keeps the rest of the chain populated.
  const leftover = budget - spent;
  if (leftover >= sides.length) {
    const outside = ladder.filter((s) => sides.every((side) => !planned.has(`${s}:${side}`)));
    const strikes = sample(outside, Math.floor(leftover / sides.length));
    if (strikes.length > 0) groups.push({ sides, strikes });
  }

  return groups;
}

function groupOf(sides: OptionSide[], strikes: number[]): SubscriptionGroup[] {
  return strikes.length > 0 ? [{ sides, strikes }] : [];
}
