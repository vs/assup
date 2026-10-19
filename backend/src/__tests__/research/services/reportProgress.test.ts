import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResearchJobDetail } from "@assup/shared";
import { ReportProgress } from "../../../services/research/reportProgress.js";

type Publish = (progress: string, detail: ResearchJobDetail) => Promise<unknown>;

function setup() {
  const calls: Array<{ progress: string; detail: ResearchJobDetail }> = [];
  const publish = vi.fn<Publish>(async (progress, detail) => {
    calls.push({ progress, detail: structuredClone(detail) });
  });
  const tracker = new ReportProgress(["technical", "options", "macro"], publish);
  return { tracker, calls, publish, last: () => calls[calls.length - 1] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T14:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("ReportProgress", () => {
  it("starts with every source pending", async () => {
    const { tracker, last } = setup();
    await tracker.begin();

    expect(last().progress).toBe("Collecting 0/3");
    expect(last().detail).toEqual({
      stage: "collecting",
      startedAt: "2026-10-16T14:00:00.000Z",
      sources: [
        { source: "technical", status: "pending" },
        { source: "options", status: "pending" },
        { source: "macro", status: "pending" },
      ],
      synthesisStartedAt: null,
      preview: null,
    });
  });

  it("timestamps sources and counts finished ones in the progress text", async () => {
    const { tracker, last } = setup();
    tracker.source({ source: "technical", status: "collecting" });
    vi.advanceTimersByTime(4_000);
    tracker.source({ source: "technical", status: "done", signal: "bullish", confidence: 0.7, detail: null });
    tracker.source({ source: "options", status: "failed", detail: "TWS not connected" });
    await tracker.flush();

    expect(last().progress).toBe("Collecting 2/3");
    expect(last().detail.sources[0]).toEqual({
      source: "technical",
      status: "done",
      signal: "bullish",
      confidence: 0.7,
      detail: null,
      startedAt: "2026-10-16T14:00:00.000Z",
      finishedAt: "2026-10-16T14:00:04.000Z",
    });
  });

  it("publishes updates in order even when they are fired without awaiting", async () => {
    const { tracker, calls } = setup();
    tracker.source({ source: "technical", status: "collecting" });
    tracker.source({ source: "technical", status: "analyzing" });
    tracker.source({ source: "technical", status: "done", detail: null });
    await tracker.flush();

    expect(calls.map((c) => c.detail.sources[0].status)).toEqual(["collecting", "analyzing", "done"]);
  });

  it("throttles the streaming preview but always delivers the latest text", async () => {
    const { tracker, calls, last } = setup();
    await tracker.synthesizing();
    const before = calls.length;

    tracker.partialText('{"recommendation": "buy", "summary": "A');
    tracker.partialText('{"recommendation": "buy", "summary": "AB');
    tracker.partialText('{"recommendation": "buy", "summary": "ABC');
    await tracker.flush();
    expect(calls.length - before).toBe(1);

    await vi.advanceTimersByTimeAsync(500);
    await tracker.flush();
    expect(calls.length - before).toBe(2);
    expect(last().progress).toBe("Writing report…");
    expect(last().detail.preview).toEqual({ recommendation: "buy", summary: "ABC" });
    expect(last().detail.synthesisStartedAt).toBe("2026-10-16T14:00:00.000Z");
  });

  it("sends the last preview before moving on to storing", async () => {
    const { tracker, calls } = setup();
    await tracker.synthesizing();
    tracker.partialText('{"summary": "A');
    tracker.partialText('{"summary": "AB');
    await tracker.storing();

    const storing = calls[calls.length - 1];
    expect(storing.progress).toBe("Saving report…");
    expect(storing.detail.preview).toEqual({ summary: "AB" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls[calls.length - 1]).toBe(storing);
  });

  it("keeps going when publishing fails", async () => {
    const { tracker, publish, calls } = setup();
    publish.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    tracker.source({ source: "technical", status: "collecting" });
    tracker.source({ source: "technical", status: "done", detail: null });
    await tracker.flush();

    expect(calls.at(-1)!.detail.sources[0].status).toBe("done");
    expect(warn).toHaveBeenCalled();
  });
});
