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
import { pipelineService } from "../../../services/research/pipeline.service.js";

describe("pipelineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateReport", () => {
    it("throws NotFoundError for unknown ticker", async () => {
      vi.mocked(prisma.researchTicker.findUnique).mockResolvedValue(null);

      await expect(pipelineService.generateReport("UNKNOWN")).rejects.toThrow(
        "Ticker 'UNKNOWN' not found"
      );
    });

    it("creates job and returns job ID", async () => {
      vi.mocked(prisma.researchTicker.findUnique).mockResolvedValue({
        id: "t1",
        symbol: "AAPL",
        status: "active",
        source: "manual",
        addedAt: new Date(),
        lastAnalyzed: null,
      } as any);
      vi.mocked(jobService.create).mockResolvedValue({
        id: "job-123",
        type: "generate_report",
        symbol: "AAPL",
        status: "pending",
        progress: null,
        result: null,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
      } as any);

      const jobId = await pipelineService.generateReport("AAPL");

      expect(jobId).toBe("job-123");
      expect(prisma.researchTicker.findUnique).toHaveBeenCalledWith({
        where: { symbol: "AAPL" },
      });
      expect(jobService.create).toHaveBeenCalledWith("generate_report", "AAPL");
    });
  });
});
