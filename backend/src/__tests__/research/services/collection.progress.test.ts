import { describe, it, expect, vi, beforeEach } from "vitest";

/** In-memory stand-ins for the two tables collectAndAnalyzeAll touches. */
const db = vi.hoisted(() => {
  type Row = { id: string; symbol: string; source: string; status: string; data: unknown; expiresAt: Date; collectedAt: Date };
  const rows: Row[] = [];
  let seq = 0;
  return {
    rows,
    reset() { rows.length = 0; seq = 0; },
    prisma: {
      dataCollection: {
        findFirst: async ({ where }: { where: { symbol: string; source: string; status?: string } }) =>
          [...rows].reverse().find((r) =>
            r.symbol === where.symbol && r.source === where.source && (!where.status || r.status === where.status)
          ) ?? null,
        create: async ({ data }: { data: Omit<Row, "id" | "collectedAt" | "status"> & { status?: string } }) => {
          const row = { id: `dc-${++seq}`, status: "ok", collectedAt: new Date(), ...data } as Row;
          rows.push(row);
          return row;
        },
      },
      analysis: {
        create: async ({ data }: { data: { source: string } }) => ({ id: `an-${data.source}` }),
      },
      watchlistItem: { updateMany: async () => ({ count: 0 }) },
    },
  };
});

vi.mock("../../../services/research/db.js", () => ({ prisma: db.prisma }));

vi.mock("../../../services/research/collectors/registry.js", () => ({
  getCollector: vi.fn(),
  getAllCollectors: vi.fn(),
}));

vi.mock("../../../services/research/analyzers/registry.js", () => ({
  getAnalyzer: vi.fn(),
}));

import { getCollector, getAllCollectors } from "../../../services/research/collectors/registry.js";
import { getAnalyzer } from "../../../services/research/analyzers/registry.js";
import type { Collector, CollectionResult } from "../../../services/research/collectors/types.js";
import {
  collectionService,
  type SourceProgressEvent,
} from "../../../services/research/collection.service.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const hour = () => new Date(Date.now() + 3_600_000);
const ok = (source: string): CollectionResult => ({ source, data: { v: 1 }, expiresAt: hour() });

/** Register collectors whose collect() is controlled per test. */
function useCollectors(impls: Record<string, () => Promise<CollectionResult>>) {
  const collectors = Object.entries(impls).map(([source, collect]) => ({
    source,
    defaultSchedule: "0 * * * *",
    stalenessMinutes: 60,
    collect: vi.fn(collect),
  })) as Array<Collector & { collect: ReturnType<typeof vi.fn> }>;
  vi.mocked(getAllCollectors).mockReturnValue(collectors);
  vi.mocked(getCollector).mockImplementation((s) => collectors.find((c) => c.source === s));
  return collectors;
}

function useAnalyzer(analyze: (source: string) => Promise<unknown> = async () => ({
  signal: "bullish", confidence: 0.7, summary: "s", details: {},
})) {
  vi.mocked(getAnalyzer).mockImplementation((source) => ({
    source,
    analyze: vi.fn(() => analyze(source)),
  }) as never);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
});

describe("collectAndAnalyzeAll", () => {
  it("starts every source at once instead of in batches", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<CollectionResult>());
    const collectors = useCollectors(Object.fromEntries(
      gates.map((g, i) => [`s${i}`, () => g.promise])
    ));
    useAnalyzer();

    const run = collectionService.collectAndAnalyzeAll("QZAC", { force: true });
    await flush();

    expect(collectors.every((c) => c.collect.mock.calls.length === 1)).toBe(true);

    gates.forEach((g, i) => g.resolve(ok(`s${i}`)));
    expect((await run).sort()).toEqual(["an-s0", "an-s1", "an-s2", "an-s3", "an-s4", "an-s5"]);
  });

  it("analyzes a source as soon as its own data arrives", async () => {
    const slow = deferred<CollectionResult>();
    useCollectors({ fast: async () => ok("fast"), slow: () => slow.promise });
    const analyzed: string[] = [];
    useAnalyzer(async (source) => {
      analyzed.push(source);
      return { signal: "neutral", confidence: 0.5, summary: "s", details: {} };
    });

    const run = collectionService.collectAndAnalyzeAll("QZAC", { force: true });
    await flush();
    await flush();

    expect(analyzed).toEqual(["fast"]);
    slow.resolve(ok("slow"));
    await run;
    expect(analyzed).toEqual(["fast", "slow"]);
  });

  it("does not collect the macro source per ticker", async () => {
    const collectors = useCollectors({ technical: async () => ok("technical"), macro: async () => ok("macro") });
    useAnalyzer();

    await collectionService.collectAndAnalyzeAll("QZAC", { force: true });

    expect(collectors.find((c) => c.source === "macro")!.collect).not.toHaveBeenCalled();
    expect(collectionService.tickerSources()).toEqual(["technical"]);
  });

  it("reports each source's progress through collection and analysis", async () => {
    useCollectors({
      technical: async () => ok("technical"),
      social: async () => ({ _tag: "skipped", source: "social", reason: "No Reddit credentials", expiresAt: hour() }),
      options: async () => { throw new Error("TWS not connected"); },
    });
    useAnalyzer(async () => ({ signal: "bullish", confidence: 0.8, summary: "s", details: {} }));
    const events: SourceProgressEvent[] = [];

    await collectionService.collectAndAnalyzeAll("QZAC", { force: true, onProgress: (e) => events.push(e) });

    const bySource = (s: string) => events.filter((e) => e.source === s);
    expect(bySource("technical")).toEqual([
      { source: "technical", status: "collecting" },
      { source: "technical", status: "analyzing", cached: false },
      { source: "technical", status: "done", cached: false, signal: "bullish", confidence: 0.8, detail: null },
    ]);
    expect(bySource("social").at(-1)).toEqual({
      source: "social", status: "skipped", cached: false, detail: "No Reddit credentials",
    });
    expect(bySource("options").at(-1)).toEqual({
      source: "options", status: "failed", detail: "TWS not connected",
    });
  });

  it("marks a source as cached when its stored data is still fresh", async () => {
    const collectors = useCollectors({ technical: async () => ok("technical") });
    useAnalyzer();
    await db.prisma.dataCollection.create({
      data: { symbol: "QZAC", source: "technical", data: { ohlcv: { close: 1 } }, expiresAt: hour() },
    });
    const events: SourceProgressEvent[] = [];

    await collectionService.collectAndAnalyzeAll("QZAC", { onProgress: (e) => events.push(e) });

    expect(collectors[0].collect).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ source: "technical", status: "done", cached: true });
  });

  it("says so when a failed collection falls back to earlier data", async () => {
    useCollectors({ technical: async () => { throw new Error("Polygon 500"); } });
    useAnalyzer();
    await db.prisma.dataCollection.create({
      data: { symbol: "QZAC", source: "technical", data: { ohlcv: { close: 1 } }, expiresAt: new Date(0) },
    });
    const events: SourceProgressEvent[] = [];

    const ids = await collectionService.collectAndAnalyzeAll("QZAC", { onProgress: (e) => events.push(e) });

    expect(ids).toEqual(["an-technical"]);
    expect(events.at(-1)).toMatchObject({
      status: "done",
      detail: "Collection failed (Polygon 500) — analyzed earlier data",
    });
  });

  it("reports an analyzer failure on its source without stopping the others", async () => {
    useCollectors({ technical: async () => ok("technical"), events: async () => ok("events") });
    useAnalyzer(async (source) => {
      if (source === "events") throw new Error("bad payload");
      return { signal: "neutral", confidence: 0.5, summary: "s", details: {} };
    });
    const events: SourceProgressEvent[] = [];

    const ids = await collectionService.collectAndAnalyzeAll("QZAC", { force: true, onProgress: (e) => events.push(e) });

    expect(ids).toEqual(["an-technical"]);
    expect(events.filter((e) => e.source === "events").at(-1)).toEqual({
      source: "events", status: "failed", detail: "Analysis failed: bad payload",
    });
  });
});
