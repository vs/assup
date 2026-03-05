import type { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";

class JobService {
  async create(type: string, symbol?: string) {
    return prisma.job.create({
      data: { type, symbol },
    });
  }

  async get(id: string) {
    return prisma.job.findUnique({ where: { id } });
  }

  async list(options: { status?: string; limit?: number } = {}) {
    return prisma.job.findMany({
      where: options.status ? { status: options.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: options.limit || 50,
    });
  }

  async start(id: string) {
    return prisma.job.update({
      where: { id },
      data: { status: "running", startedAt: new Date() },
    });
  }

  async updateProgress(id: string, progress: string) {
    return prisma.job.update({
      where: { id },
      data: { progress },
    });
  }

  async complete(id: string, result: Record<string, unknown>) {
    return prisma.job.update({
      where: { id },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  async fail(id: string, error: string) {
    return prisma.job.update({
      where: { id },
      data: {
        status: "failed",
        error,
        completedAt: new Date(),
      },
    });
  }
}

export const jobService = new JobService();
