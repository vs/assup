import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { sseService } from "../sse.js";

class JobService {
  private broadcastIfReport(job: { id: string; type: string; symbol: string | null; status: string; progress: string | null; error: string | null }) {
    if (job.type !== "generate_report" || !job.symbol) return;
    sseService.broadcast("research_job", {
      jobId: job.id,
      symbol: job.symbol,
      status: job.status,
      progress: job.progress,
      error: job.error,
    });
  }

  async create(type: string, symbol?: string) {
    const job = await prisma.researchJob.create({
      data: { type, symbol },
    });
    this.broadcastIfReport(job);
    return job;
  }

  async get(id: string) {
    return prisma.researchJob.findUnique({ where: { id } });
  }

  async list(options: { status?: string | string[]; type?: string; limit?: number } = {}) {
    const where: Prisma.ResearchJobWhereInput = {};
    if (options.status) {
      where.status = Array.isArray(options.status) ? { in: options.status } : options.status;
    }
    if (options.type) {
      where.type = options.type;
    }
    return prisma.researchJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options.limit || 50,
    });
  }

  async start(id: string) {
    const job = await prisma.researchJob.update({
      where: { id },
      data: { status: "running", startedAt: new Date() },
    });
    this.broadcastIfReport(job);
    return job;
  }

  async updateProgress(id: string, progress: string) {
    const job = await prisma.researchJob.update({
      where: { id },
      data: { progress },
    });
    this.broadcastIfReport(job);
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
    this.broadcastIfReport(job);
    return job;
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
    this.broadcastIfReport(job);
    return job;
  }
}

export const jobService = new JobService();
