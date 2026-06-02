import { describe, it, expect, beforeEach } from "vitest";
import { MarketDataLineRegistry } from "../../services/marketDataLineRegistry.js";

describe("MarketDataLineRegistry", () => {
  let registry: MarketDataLineRegistry;

  beforeEach(() => {
    registry = new MarketDataLineRegistry(100);
  });

  it("reports full availability initially", () => {
    expect(registry.available()).toBe(100);
  });

  it("reserves requested lines when budget allows", () => {
    const granted = registry.reserve("session-1", 50);
    expect(granted).toBe(50);
    expect(registry.available()).toBe(50);
  });

  it("grants partial lines when budget is insufficient", () => {
    registry.reserve("session-1", 80);
    const granted = registry.reserve("session-2", 50);
    expect(granted).toBe(20);
    expect(registry.available()).toBe(0);
  });

  it("grants zero when budget is exhausted", () => {
    registry.reserve("session-1", 100);
    const granted = registry.reserve("session-2", 10);
    expect(granted).toBe(0);
  });

  it("releases lines back to the pool", () => {
    registry.reserve("session-1", 60);
    registry.release("session-1");
    expect(registry.available()).toBe(100);
  });

  it("handles releasing unknown session gracefully", () => {
    registry.release("unknown");
    expect(registry.available()).toBe(100);
  });

  it("tracks multiple sessions independently", () => {
    registry.reserve("session-1", 30);
    registry.reserve("session-2", 40);
    expect(registry.available()).toBe(30);
    registry.release("session-1");
    expect(registry.available()).toBe(60);
  });
});
