import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../services/research/db.js", () => ({
  prisma: {
    dataCollection: { findFirst: vi.fn(), create: vi.fn() },
    analysis: { create: vi.fn() },
    watchlistItem: { updateMany: vi.fn() },
  },
}));

import { collectionService } from "../../../services/research/collection.service.js";
import { registerCollector } from "../../../services/research/collectors/registry.js";
import type { CollectionResult } from "../../../services/research/collectors/types.js";

/** A collector whose collect() never settles — the QZHI failure mode. */
function registerHangingCollector(source: string): void {
  registerCollector({
    source,
    defaultSchedule: "0 18 * * 1-5",
    stalenessMinutes: 1440,
    collect: () => new Promise<CollectionResult>(() => {}),
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("collectSource deadline", () => {
  it("fails a collector that never settles instead of hanging forever", async () => {
    registerHangingCollector("hanging");

    const result = collectionService.collectSource("QZHI", "hanging", true);
    const assertion = expect(result).rejects.toThrow(/hanging.*QZHI.*timed out/i);

    await vi.advanceTimersByTimeAsync(180_000);
    await assertion;
  });
});
