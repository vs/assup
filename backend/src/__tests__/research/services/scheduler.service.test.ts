import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../../services/research/db.js", () => ({
  prisma: createMockPrisma(),
}));

const { mockSchedule, mockValidate } = vi.hoisted(() => ({
  mockSchedule: vi.fn(),
  mockValidate: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}));

vi.mock("../../../services/research/collection.service.js", () => ({
  collectionService: {
    collectAndAnalyzeAll: vi.fn(),
    collectSource: vi.fn(),
    analyzeSource: vi.fn(),
  },
}));

vi.mock("../../../services/research/macro.service.js", () => ({
  macroService: {
    collectAndAnalyze: vi.fn(),
  },
}));

vi.mock("../../../services/research/pipeline.service.js", () => ({
  pipelineService: {
    generateReport: vi.fn(),
  },
}));

vi.mock("../../../services/research/market-scanner.service.js", () => ({
  marketScannerService: {
    runPreset: vi.fn(),
  },
}));

vi.mock("../../../services/flex-web.service.js", () => ({
  flexWebService: {
    getConfig: vi.fn().mockResolvedValue({ enabled: false }),
    fetchAndImport: vi.fn(),
  },
  scheduleToCron: vi.fn().mockReturnValue("0 6 * * 2-6"),
}));

import { prisma } from "../../../services/research/db.js";
import { schedulerService } from "../../../services/research/scheduler.service.js";

describe("schedulerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset scheduler state — stop any previously accumulated jobs
    schedulerService.stop();
    // Re-setup mocks after clearAllMocks (mockReset:true resets return values)
    mockSchedule.mockReturnValue({ stop: vi.fn() });
    mockValidate.mockReturnValue(true);
    // refreshScannerSchedules is called inside start(), mock findMany for that
    vi.mocked((prisma as any).marketScannerPreset.findMany).mockResolvedValue([]);
  });

  describe("start", () => {
    it("schedules 3 core cron jobs", () => {
      schedulerService.start();

      // 3 core jobs: daily collection, social, report generation
      expect(mockSchedule).toHaveBeenCalledTimes(3);

      // Verify cron expressions
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 18 * * 1-5",
        expect.any(Function),
        { timezone: "America/New_York" }
      );
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 */6 * * 1-5",
        expect.any(Function),
        { timezone: "America/New_York" }
      );
      expect(mockSchedule).toHaveBeenCalledWith(
        "30 18 * * 1-5",
        expect.any(Function),
        { timezone: "America/New_York" }
      );
    });
  });

  describe("stop", () => {
    it("stops all jobs", () => {
      const stopFns = [vi.fn(), vi.fn(), vi.fn()];
      mockSchedule
        .mockReturnValueOnce({ stop: stopFns[0] })
        .mockReturnValueOnce({ stop: stopFns[1] })
        .mockReturnValueOnce({ stop: stopFns[2] });

      schedulerService.start();
      schedulerService.stop();

      for (const stopFn of stopFns) {
        expect(stopFn).toHaveBeenCalled();
      }
    });
  });

  describe("refreshScannerSchedules", () => {
    it("loads enabled presets and creates cron jobs", async () => {
      vi.mocked((prisma as any).marketScannerPreset.findMany).mockResolvedValue([
        {
          id: "cfg-1",
          name: "Growth",
          scanCode: "TOP_PERC_GAIN",
          locationCode: "STK.US.MAJOR",
          filters: {},
          technicalFilter: { enabled: false },
          schedule: "0 9 * * 1-5",
          enabled: true,
          lastRun: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cfg-2",
          name: "Value",
          scanCode: "HIGH_DIVIDEND_YIELD_IB",
          locationCode: "STK.US.MAJOR",
          filters: {},
          technicalFilter: { enabled: false },
          schedule: "0 10 * * 1-5",
          enabled: true,
          lastRun: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      await schedulerService.refreshScannerSchedules();

      // findMany called with enabled: true filter
      expect((prisma as any).marketScannerPreset.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
      });

      // validate called for each preset
      expect(mockValidate).toHaveBeenCalledWith("0 9 * * 1-5");
      expect(mockValidate).toHaveBeenCalledWith("0 10 * * 1-5");

      // schedule called for each valid preset
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 9 * * 1-5",
        expect.any(Function),
        { timezone: "America/New_York" }
      );
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 10 * * 1-5",
        expect.any(Function),
        { timezone: "America/New_York" }
      );
    });

    it("skips invalid cron expressions for scanner presets", async () => {
      mockValidate
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      vi.mocked((prisma as any).marketScannerPreset.findMany).mockResolvedValue([
        {
          id: "cfg-1",
          name: "Valid",
          scanCode: "TOP_PERC_GAIN",
          locationCode: "STK.US.MAJOR",
          filters: {},
          technicalFilter: { enabled: false },
          schedule: "0 9 * * 1-5",
          enabled: true,
          lastRun: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cfg-2",
          name: "Invalid",
          scanCode: "TOP_PERC_GAIN",
          locationCode: "STK.US.MAJOR",
          filters: {},
          technicalFilter: { enabled: false },
          schedule: "not-a-cron",
          enabled: true,
          lastRun: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);

      await schedulerService.refreshScannerSchedules();

      // validate called for both
      expect(mockValidate).toHaveBeenCalledTimes(2);

      // Only 1 cron.schedule call (the valid one)
      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(mockSchedule).toHaveBeenCalledWith(
        "0 9 * * 1-5",
        expect.any(Function),
        { timezone: "America/New_York" }
      );
    });
  });
});
