import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../../services/research/db.js", () => ({
  prisma: createMockPrisma(),
}));

vi.mock("../../../services/research/collectors/macro.collector.js", () => ({
  macroCollector: {
    collect: vi.fn(),
  },
}));

vi.mock("../../../services/research/analyzers/macro.analyzer.js", () => ({
  macroAnalyzer: {
    analyze: vi.fn(),
  },
}));

import { prisma } from "../../../services/research/db.js";
import { macroCollector } from "../../../services/research/collectors/macro.collector.js";
import { macroAnalyzer } from "../../../services/research/analyzers/macro.analyzer.js";
import { macroService } from "../../../services/research/macro.service.js";

describe("macroService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached snapshot when fresh (< 24h)", async () => {
    const recentSnapshot = {
      id: "snap-1",
      regime: "risk_on",
      confidence: 0.8,
      summary: "Bull market",
      details: {},
      analyzedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
    };
    vi.mocked(prisma.macroSnapshot.findFirst).mockResolvedValue(recentSnapshot as any);

    const result = await macroService.collectAndAnalyze();
    expect(result).toEqual(recentSnapshot);
    expect(macroCollector.collect).not.toHaveBeenCalled();
    expect(macroAnalyzer.analyze).not.toHaveBeenCalled();
  });

  it("collects fresh data when stale (> 24h)", async () => {
    const staleSnapshot = {
      id: "snap-old",
      regime: "neutral",
      confidence: 0.5,
      summary: "Old data",
      details: {},
      analyzedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
    };
    vi.mocked(prisma.macroSnapshot.findFirst).mockResolvedValue(staleSnapshot as any);

    const collectedData = {
      source: "macro",
      data: { vix: 15, sp500Price: 500, vixSma20: 16, sp500Sma200: 480 },
      expiresAt: new Date(),
    };
    vi.mocked(macroCollector.collect).mockResolvedValue(collectedData);
    vi.mocked(macroAnalyzer.analyze).mockResolvedValue({
      signal: "bullish",
      confidence: 0.9,
      summary: "Risk on environment",
      details: { regime: "risk_on" },
    });

    const newSnapshot = {
      id: "snap-2",
      regime: "risk_on",
      confidence: 0.9,
      summary: "Risk on environment",
      details: { regime: "risk_on" },
      analyzedAt: new Date(),
    };
    vi.mocked(prisma.macroSnapshot.create).mockResolvedValue(newSnapshot as any);

    const result = await macroService.collectAndAnalyze();
    expect(result).toEqual(newSnapshot);
    expect(macroCollector.collect).toHaveBeenCalledWith("");
    expect(macroAnalyzer.analyze).toHaveBeenCalledWith(collectedData.data);
    expect(prisma.macroSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          regime: "risk_on",
          confidence: 0.9,
        }),
      })
    );
  });

  it("forces collection when force=true", async () => {
    const collectedData = {
      source: "macro",
      data: { vix: 15, sp500Price: 500, vixSma20: 16, sp500Sma200: 480 },
      expiresAt: new Date(),
    };
    vi.mocked(macroCollector.collect).mockResolvedValue(collectedData);
    vi.mocked(macroAnalyzer.analyze).mockResolvedValue({
      signal: "neutral",
      confidence: 0.5,
      summary: "Mixed signals",
      details: { regime: "neutral" },
    });

    const newSnapshot = {
      id: "snap-3",
      regime: "neutral",
      confidence: 0.5,
      summary: "Mixed signals",
      details: { regime: "neutral" },
      analyzedAt: new Date(),
    };
    vi.mocked(prisma.macroSnapshot.create).mockResolvedValue(newSnapshot as any);

    const result = await macroService.collectAndAnalyze(true);
    expect(result).toEqual(newSnapshot);
    // Should NOT check for existing snapshots when force=true
    expect(prisma.macroSnapshot.findFirst).not.toHaveBeenCalled();
    expect(macroCollector.collect).toHaveBeenCalledWith("");
  });

  it("maps signal to regime correctly (bearish -> risk_off)", async () => {
    vi.mocked(prisma.macroSnapshot.findFirst).mockResolvedValue(null);

    const collectedData = {
      source: "macro",
      data: { vix: 30, sp500Price: 400, vixSma20: 25, sp500Sma200: 450 },
      expiresAt: new Date(),
    };
    vi.mocked(macroCollector.collect).mockResolvedValue(collectedData);
    vi.mocked(macroAnalyzer.analyze).mockResolvedValue({
      signal: "bearish",
      confidence: 0.85,
      summary: "Risk off environment",
      details: { regime: "risk_off" },
    });

    const newSnapshot = {
      id: "snap-4",
      regime: "risk_off",
      confidence: 0.85,
      summary: "Risk off environment",
      details: { regime: "risk_off" },
      analyzedAt: new Date(),
    };
    vi.mocked(prisma.macroSnapshot.create).mockResolvedValue(newSnapshot as any);

    await macroService.collectAndAnalyze();

    expect(prisma.macroSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          regime: "risk_off",
        }),
      })
    );
  });
});
