import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import type { ResearchJobDetail } from "@assup/shared";
import { sseService } from "../sse.js";

type JobFields = { id: string; type: string; symbol: string | null; status: string; progress: string | null; error: string | null };

class JobService {
  /**
   * Structured progress of running jobs. Jobs run in-process and are failed
   * on restart, so memory is the right lifetime for it: it streams to the UI
   * many times a second without a database write each time.
   */
  private live = new Map<string, { job: JobFields; detail: ResearchJobDetail | null }>();

  private broadcastIfReport(job: JobFields, detail: ResearchJobDetail | null = null) {
    if (job.type !== "generate_report" || !job.symbol) return;
    sseService.broadcast("research_job", {
      jobId: job.id,
      symbol: job.symbol,
      status: job.status,
      progress: job.progress,
      error: job.error,
      detail,
    });
  }

  private withDetail<T extends { id: string }>(job: T): T & { detail?: ResearchJobDetail } {
    const detail = this.live.get(job.id)?.detail;
    return detail ? { ...job, detail } : job;
  }

  async create(type: string, symbol?: string) {
    const job = await prisma.researchJob.create({
      data: { type, symbol },
    });
    this.broadcastIfReport(job);
    return job;
  }

  async get(id: string) {
    const job = await prisma.researchJob.findUnique({ where: { id } });
    return job ? this.withDetail(job) : null;
  }

  async list(options: { status?: string | string[]; type?: string; limit?: number } = {}) {
    const where: Prisma.ResearchJobWhereInput = {};
    if (options.status) {
      where.status = Array.isArray(options.status) ? { in: options.status } : options.status;
    }
    if (options.type) {
      where.type = options.type;
    }
    const jobs = await prisma.researchJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options.limit || 50,
    });
    return jobs.map((job) => this.withDetail(job));
  }

  async start(id: string) {
    const job = await prisma.researchJob.update({
      where: { id },
      data: { status: "running", startedAt: new Date() },
    });
    this.live.set(id, { job, detail: null });
    this.broadcastIfReport(job);
    return job;
  }

  /**
   * Update the progress text and, optionally, the structured detail. The
   * database is written only when the text changes; the detail is kept in
   * memory and every call is broadcast.
   */
  async updateProgress(id: string, progress: string, detail?: ResearchJobDetail) {
    const entry = this.live.get(id);
    const job: JobFields = entry && entry.job.progress === progress
      ? entry.job
      : await prisma.researchJob.update({ where: { id }, data: { progress } });
    const nextDetail = detail ?? entry?.detail ?? null;
    this.live.set(id, { job, detail: nextDetail });
    this.broadcastIfReport(job, nextDetail);
    return job;
  }

  async complete(id: string, result: Record<string, unknown>) {
    const job = await prisma.researchJob.update({
      where: { id },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    this.live.delete(id);
    this.broadcastIfReport(job);
    return job;
  }

  /**
   * Mark jobs left in "queued"/"running" state as failed (server restart scenario).
   * Jobs run in-process, so any job still active at startup was orphaned by a restart.
   */
  async failStaleJobs() {
    const result = await prisma.researchJob.updateMany({
      where: { status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        error: "Server restarted while job was in progress",
        completedAt: new Date(),
      },
    });
    if (result.count > 0) {
      console.log(`[JobService] Marked ${result.count} stale research jobs as failed`);
    }
    return result.count;
  }

  async fail(id: string, error: string) {
    const job = await prisma.researchJob.update({
      where: { id },
      data: {
        status: "failed",
        error,
        completedAt: new Date(),
      },
    });
    this.live.delete(id);
    this.broadcastIfReport(job);
    return job;
  }
}

export const jobService = new JobService();
