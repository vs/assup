import { describe, it, expect } from "vitest";
import {
  planStrikeSubscriptions,
  plannedContractCount,
  type SubscriptionGroup,
} from "../../services/spreadSubscriptionPlan.js";

/** SPX-style ladder: 5-point strikes around a ~7670 underlying. */
function ladder(from: number, to: number, step = 5): number[] {
  const out: number[] = [];
  for (let s = from; s <= to; s += step) out.push(s);
  return out;
}

function strikesFor(groups: SubscriptionGroup[], side: "P" | "C"): number[] {
  const out = new Set<number>();
  for (const g of groups) {
    if (!g.sides.includes(side)) continue;
    for (const s of g.strikes) out.add(s);
  }
  return [...out].sort((a, b) => a - b);
}

describe("planStrikeSubscriptions", () => {
  const SPX = ladder(5950, 8050);

  it("streams the whole ladder when it fits the budget", () => {
    const strikes = ladder(7000, 7100);
    const groups = planStrikeSubscriptions({
      strikes,
      sides: ["P", "C"],
      budget: 200,
    });
    expect(strikesFor(groups, "P")).toEqual(strikes);
    expect(strikesFor(groups, "C")).toEqual(strikes);
  });

  it("samples the ladder end to end when it exceeds the budget", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      budget: 97,
    });
    expect(plannedContractCount(groups)).toBeLessThanOrEqual(97);
    const puts = strikesFor(groups, "P");
    expect(puts[0]).toBe(5950);
    expect(puts[puts.length - 1]).toBe(8050);
  });

  // The bug: an iron condor's focus ranges cover far more strikes than the line
  // budget, and taking them in ladder order spent every line on the put wing —
  // the call wing never got a market data line, so its side of the chain
  // stayed empty.
  it("covers both wings when the focus ranges exceed the line budget", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      budget: 97,
      focusRanges: [
        { min: 7430, max: 7730, sides: ["P"] },
        { min: 7610, max: 7910, sides: ["C"] },
      ],
    });

    expect(plannedContractCount(groups)).toBeLessThanOrEqual(97);

    const calls = strikesFor(groups, "C");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toBe(7610);
    expect(calls[calls.length - 1]).toBe(7910);

    const puts = strikesFor(groups, "P");
    expect(puts[0]).toBe(7430);
    expect(puts.filter((s) => s >= 7430 && s <= 7730).length).toBeGreaterThan(0);
  });

  it("splits the budget evenly between two equally hungry ranges", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      budget: 97,
      focusRanges: [
        { min: 7430, max: 7730, sides: ["P"] },
        { min: 7610, max: 7910, sides: ["C"] },
      ],
    });
    const puts = strikesFor(groups, "P").filter((s) => s >= 7430 && s <= 7730);
    const calls = strikesFor(groups, "C").filter((s) => s >= 7610 && s <= 7910);
    expect(Math.abs(puts.length - calls.length)).toBeLessThanOrEqual(1);
  });

  it("only streams the sides a range asks for", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      // Exactly what the range wants, so nothing is left over to spread
      // across the rest of the ladder.
      budget: 21,
      focusRanges: [{ min: 7600, max: 7700, sides: ["C"] }],
    });
    expect(strikesFor(groups, "P")).toEqual([]);
    expect(strikesFor(groups, "C")).toEqual(ladder(7600, 7700));
  });

  it("spends budget left over by the focus ranges on the rest of the ladder", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      budget: 97,
      focusRanges: [{ min: 7600, max: 7620, sides: ["C"] }],
    });
    expect(plannedContractCount(groups)).toBeLessThanOrEqual(97);
    // The focus range wants 5 contracts; the rest must not go to waste.
    expect(plannedContractCount(groups)).toBeGreaterThan(80);
    const puts = strikesFor(groups, "P");
    expect(puts[0]).toBe(5950);
    expect(puts[puts.length - 1]).toBe(8050);
  });

  it("plans nothing when there is no budget", () => {
    expect(
      planStrikeSubscriptions({ strikes: SPX, sides: ["P", "C"], budget: 0 }),
    ).toEqual([]);
  });

  it("plans a single strike rather than NaN when the budget allows only one", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      budget: 2,
    });
    const puts = strikesFor(groups, "P");
    expect(puts).toHaveLength(1);
    expect(Number.isFinite(puts[0])).toBe(true);
  });

  it("never plans the same contract twice when ranges overlap", () => {
    const groups = planStrikeSubscriptions({
      strikes: SPX,
      sides: ["P", "C"],
      budget: 97,
      focusRanges: [
        { min: 7600, max: 7700, sides: ["P"] },
        { min: 7650, max: 7750, sides: ["P"] },
      ],
    });
    const seen = new Set<string>();
    for (const g of groups) {
      for (const s of g.strikes) {
        for (const side of g.sides) {
          const key = `${s}:${side}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });
});
