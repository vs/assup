import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../../services/research/db.js", () => ({
  prisma: createMockPrisma(),
}));

vi.mock("../../../services/research/job.service.js", () => ({
  jobService: {
    create: vi.fn(),
    start: vi.fn(),
    updateProgress: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  },
}));

vi.mock("../../../services/research/collection.service.js", () => ({
  collectionService: {
    collectAndAnalyzeAll: vi.fn(),
    tickerSources: vi.fn(),
  },
}));

vi.mock("../../../services/research/macro.service.js", () => ({
  macroService: {
    collectAndAnalyze: vi.fn(),
  },
}));

vi.mock("../../../services/research/synthesizer/synthesizer.js", () => ({
  synthesize: vi.fn(),
}));

import { prisma } from "../../../services/research/db.js";
import { jobService } from "../../../services/research/job.service.js";
import { collectionService } from "../../../services/research/collection.service.js";
import { macroService } from "../../../services/research/macro.service.js";
import { synthesize } from "../../../services/research/synthesizer/synthesizer.js";
import { pipelineService } from "../../../services/research/pipeline.service.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Wait for the background pipeline to reach a terminal job state. */
async function untilFinished() {
  await vi.waitFor(() => {
    const done = vi.mocked(jobService.complete).mock.calls.length + vi.mocked(jobService.fail).mock.calls.length;
    if (done === 0) throw new Error("pipeline still running");
  });
}

const synthResult = {
  recommendation: "buy", confidence: 0.7, summary: "s", fullReport: "## r", companyOverview: null,
};

describe("pipelineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobService.create).mockResolvedValue({ id: "job-123" } as any);
    vi.mocked(collectionService.tickerSources).mockReturnValue(["technical", "options"]);
    vi.mocked(prisma.analysis.findMany).mockResolvedValue([
      { source: "technical", signal: "bullish", confidence: 0.7, summary: "s", details: {} },
    ] as any);
    vi.mocked(prisma.macroSnapshot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.researchReport.create).mockResolvedValue({ id: "rep-1" } as any);
    vi.mocked(synthesize).mockResolvedValue(synthResult);
  });

  it("creates job and returns job ID", async () => {
    vi.mocked(collectionService.collectAndAnalyzeAll).mockResolvedValue(["an-1"]);
    vi.mocked(macroService.collectAndAnalyze).mockResolvedValue({ analyzedAt: new Date(), regime: "neutral", confidence: 0.5 } as any);

    const jobId = await pipelineService.generateReport("QZAC");

    expect(jobId).toBe("job-123");
    expect(jobService.create).toHaveBeenCalledWith("generate_report", "QZAC");
    await untilFinished();
  });

  it("refreshes macro alongside collection instead of after it", async () => {
    const collection = deferred<string[]>();
    vi.mocked(collectionService.collectAndAnalyzeAll).mockReturnValue(collection.promise);
    vi.mocked(macroService.collectAndAnalyze).mockResolvedValue({ analyzedAt: new Date(), regime: "risk_on", confidence: 0.6 } as any);

    await pipelineService.generateReport("QZAC");
    await vi.waitFor(() => expect(macroService.collectAndAnalyze).toHaveBeenCalled());
    expect(synthesize).not.toHaveBeenCalled();

    collection.resolve(["an-1"]);
    await untilFinished();
    expect(jobService.complete).toHaveBeenCalledWith("job-123", expect.objectContaining({ reportId: "rep-1" }));
  });

  it("publishes per-source progress, then the streaming report, then completes", async () => {
    vi.mocked(collectionService.collectAndAnalyzeAll).mockImplementation(async (_s, opts) => {
      opts!.onProgress!({ source: "technical", status: "collecting" });
      opts!.onProgress!({ source: "technical", status: "done", signal: "bullish", confidence: 0.7, detail: null });
      opts!.onProgress!({ source: "options", status: "skipped", detail: "TWS not connected" });
      return ["an-1"];
    });
    vi.mocked(macroService.collectAndAnalyze).mockRejectedValue(new Error("TradingView down"));
    vi.mocked(synthesize).mockImplementation(async (_input, opts: any) => {
      opts.onPartialText('{"recommendation": "buy", "summary": "Strong');
      return synthResult;
    });

    await pipelineService.generateReport("QZAC");
    await untilFinished();

    const updates = vi.mocked(jobService.updateProgress).mock.calls.map(([, text, detail]) => ({ text, detail: detail! }));
    expect(updates[0].text).toBe("Collecting 0/3");
    const collected = updates.find((u) => u.text === "Collecting 3/3")!;
    expect(collected.detail.sources.map((s) => [s.source, s.status])).toEqual([
      ["technical", "done"], ["options", "skipped"], ["macro", "failed"],
    ]);
    expect(collected.detail.sources[2].detail).toBe("TradingView down");
    expect(updates.some((u) => u.detail.preview?.summary === "Strong")).toBe(true);
    expect(updates.at(-1)!.text).toBe("Saving report…");

    // Nothing is published after the job is marked complete
    const lastUpdate = Math.max(...vi.mocked(jobService.updateProgress).mock.invocationCallOrder);
    expect(vi.mocked(jobService.complete).mock.invocationCallOrder[0]).toBeGreaterThan(lastUpdate);
  });

  it("fails the job when no source produced an analysis", async () => {
    vi.mocked(collectionService.collectAndAnalyzeAll).mockResolvedValue([]);
    vi.mocked(macroService.collectAndAnalyze).mockResolvedValue({ analyzedAt: new Date(), regime: "neutral", confidence: 0.5 } as any);

    await pipelineService.generateReport("QZAC");
    await untilFinished();

    expect(jobService.fail).toHaveBeenCalledWith("job-123", expect.stringContaining("No analysis results"));
    expect(synthesize).not.toHaveBeenCalled();
  });
});
