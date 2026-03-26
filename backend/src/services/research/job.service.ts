import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

class JobService {
  async create(type: string, symbol?: string) {
    return prisma.researchJob.create({
      data: { type, symbol },
    });
  }

  async get(id: string) {
    return prisma.researchJob.findUnique({ where: { id } });
  }

  async list(options: { status?: string; limit?: number } = {}) {
    return prisma.researchJob.findMany({
      where: options.status ? { status: options.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: options.limit || 50,
    });
  }

  async start(id: string) {
    return prisma.researchJob.update({
      where: { id },
      data: { status: "running", startedAt: new Date() },
    });
  }

  async updateProgress(id: string, progress: string) {
    return prisma.researchJob.update({
      where: { id },
      data: { progress },
    });
  }

  async complete(id: string, result: Record<string, unknown>) {
    return prisma.researchJob.update({
      where: { id },
      data: {
        status: "completed",
        result: result as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  async fail(id: string, error: string) {
    return prisma.researchJob.update({
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
