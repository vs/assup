import { vi } from "vitest";

export function createMockPrisma() {
  return {
    ticker: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createManyAndReturn: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    dataCollection: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    analysis: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    job: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    report: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    macroSnapshot: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    screenerConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
}
