import { describe, it, expect } from "vitest";
import { optionsAnalyzer } from "../../analyzers/options.analyzer.js";
import { generateOptionsChain } from "../fixtures/options-chain.js";

describe("optionsAnalyzer", () => {
  it("returns neutral with 0 confidence for empty chain", async () => {
    const result = await optionsAnalyzer.analyze({ chain: [] });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
    expect(result.summary).toContain("No options chain data");
    expect((result.details as Record<string, unknown>).putCallRatio).toBeNull();
  });

  it("returns neutral with 0 confidence for null chain", async () => {
    const result = await optionsAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
  });

  it("computes avgIV from non-null IV values", async () => {
    const chain = generateOptionsChain({ iv: 0.4 });
    const result = await optionsAnalyzer.analyze({ chain });
    const details = result.details as Record<string, unknown>;
    expect(details.avgIV).toBeCloseTo(0.4, 1);
  });

  it("returns null putCallRatio when total call volume < 100", async () => {
    // MIN_VOLUME_FOR_RATIO = 100 applies to totalCallVolume across all entries.
    // With callVolume=10 per entry * 5 strikes = 50 total < 100 → null ratio.
    const chain = generateOptionsChain({ callVolume: 10, putVolume: 10 });
    const result = await optionsAnalyzer.analyze({ chain });
    const details = result.details as Record<string, unknown>;
    expect(details.putCallRatio).toBeNull();
  });

  it("computes putCallRatio when call volume >= 100", async () => {
    const chain = generateOptionsChain({ callVolume: 500, putVolume: 300 });
    const result = await optionsAnalyzer.analyze({ chain });
    const details = result.details as Record<string, unknown>;
    expect(details.putCallRatio).toBeTypeOf("number");
    // total put vol = 300*5 = 1500, total call vol = 500*5 = 2500
    expect(details.putCallRatio).toBeCloseTo(1500 / 2500, 2);
  });

  it("detects unusual activity (volume > 3x openInterest)", async () => {
    const chain = generateOptionsChain({ callVolume: 5000, openInterest: 100 });
    const result = await optionsAnalyzer.analyze({ chain });
    const details = result.details as Record<string, unknown>;
    const unusual = details.unusualActivity as Array<Record<string, unknown>>;
    expect(unusual.length).toBeGreaterThan(0);
  });

  it("returns empty unusual activity for normal volume", async () => {
    const chain = generateOptionsChain({ callVolume: 100, openInterest: 1000 });
    const result = await optionsAnalyzer.analyze({ chain });
    const details = result.details as Record<string, unknown>;
    const unusual = details.unusualActivity as Array<Record<string, unknown>>;
    expect(unusual.length).toBe(0);
  });

  it("computes wheelSuitability between 0 and 1", async () => {
    const chain = generateOptionsChain({ iv: 0.5, bidAskSpread: 0.05 });
    const result = await optionsAnalyzer.analyze({ chain });
    const details = result.details as Record<string, unknown>;
    expect(details.wheelSuitability).toBeGreaterThanOrEqual(0);
    expect(details.wheelSuitability).toBeLessThanOrEqual(1);
  });

  it("signals bullish for high IV rank + low PCR", async () => {
    // Need ivRank > 50 for score +1, and > 75 for additional +1, plus PCR < 0.7 for +1.
    // Using 1 low-IV chain and 3 high-IV chains to skew average IV upward:
    // avg = (10*0.1 + 30*0.9)/40 = 0.7, ivRank = (0.7-0.1)/(0.9-0.1)*100 = 75
    // ivRank > 50 → +1, ivRank > 75 is false (not strict >), PCR = 0.2 → +1, total = 2 → bullish
    const chain = [
      ...generateOptionsChain({ iv: 0.1, callVolume: 500, putVolume: 100 }),
      ...generateOptionsChain({ iv: 0.9, callVolume: 500, putVolume: 100 }),
      ...generateOptionsChain({ iv: 0.9, callVolume: 500, putVolume: 100 }),
      ...generateOptionsChain({ iv: 0.9, callVolume: 500, putVolume: 100 }),
    ];
    const result = await optionsAnalyzer.analyze({ chain });
    expect(result.signal).toBe("bullish");
  });

  it("handles chain entries with null IV", async () => {
    const chain = generateOptionsChain();
    chain[0].impliedVolatility = null;
    chain[1].impliedVolatility = null;
    const result = await optionsAnalyzer.analyze({ chain });
    expect(result.signal).toBeDefined();
    const details = result.details as Record<string, unknown>;
    expect(details.avgIV).toBeTypeOf("number");
  });

  it("confidence is capped at 1", async () => {
    const chain = generateOptionsChain({ callVolume: 500, putVolume: 100, iv: 0.8 });
    const result = await optionsAnalyzer.analyze({ chain });
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});
