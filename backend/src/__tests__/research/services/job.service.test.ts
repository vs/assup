import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../../services/research/db.js", () => ({
  prisma: createMockPrisma(),
}));

import { prisma } from "../../../services/research/db.js";
import { jobService } from "../../../services/research/job.service.js";

describe("jobService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a job", async () => {
    const job = { id: "job-1", type: "generate_report", symbol: "AAPL", status: "queued", progress: null, result: null, error: null, createdAt: new Date(), startedAt: null, completedAt: null };
    vi.mocked(prisma.researchJob.create).mockResolvedValue(job);

    const result = await jobService.create("generate_report", "AAPL");
    expect(result.type).toBe("generate_report");
    expect(result.symbol).toBe("AAPL");
  });

  it("gets a job by id", async () => {
    const job = { id: "job-1", type: "generate_report", symbol: "AAPL", status: "queued", progress: null, result: null, error: null, createdAt: new Date(), startedAt: null, completedAt: null };
    vi.mocked(prisma.researchJob.findUnique).mockResolvedValue(job);

    const result = await jobService.get("job-1");
    expect(result).toEqual(job);
  });

  it("returns null for unknown job", async () => {
    vi.mocked(prisma.researchJob.findUnique).mockResolvedValue(null);
    const result = await jobService.get("unknown");
    expect(result).toBeNull();
  });

  it("lists jobs with optional filters", async () => {
    vi.mocked(prisma.researchJob.findMany).mockResolvedValue([]);
    await jobService.list({ status: "running", limit: 10 });
    expect(prisma.researchJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "running" }, take: 10 })
    );
  });

  it("starts a job (sets status=running)", async () => {
    vi.mocked(prisma.researchJob.update).mockResolvedValue({} as any);
    await jobService.start("job-1");
    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1" }, data: expect.objectContaining({ status: "running" }) })
    );
  });

  it("completes a job with result", async () => {
    vi.mocked(prisma.researchJob.update).mockResolvedValue({} as any);
    await jobService.complete("job-1", { reportId: "r-1" });
    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed", result: { reportId: "r-1" } }) })
    );
  });

  it("marks stale queued/running jobs as failed on startup", async () => {
    vi.mocked(prisma.researchJob.updateMany).mockResolvedValue({ count: 3 });

    const count = await jobService.failStaleJobs();

    expect(count).toBe(3);
    expect(prisma.researchJob.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] } },
      data: expect.objectContaining({
        status: "failed",
        error: "Server restarted while job was in progress",
        completedAt: expect.any(Date),
      }),
    });
  });

  it("fails a job with error message", async () => {
    vi.mocked(prisma.researchJob.update).mockResolvedValue({} as any);
    await jobService.fail("job-1", "Something went wrong");
    expect(prisma.researchJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed", error: "Something went wrong" }) })
    );
  });
});
