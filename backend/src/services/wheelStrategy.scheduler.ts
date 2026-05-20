import cron, { type ScheduledTask } from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "../db/index.js";
import { wheelStrategyService } from "./wheelStrategy.service.js";

class WheelStrategyScheduler {
  private jobs = new Map<string, ScheduledTask>();

  async start(): Promise<void> {
    const strategies = await prisma.wheelStrategy.findMany({
      where: { enabled: true },
    });

    for (const strategy of strategies) {
      this.registerJob(strategy.id, strategy.intervalHours, strategy.cronExpression);
    }

    console.log(`[WheelStrategyScheduler] Started with ${this.jobs.size} jobs`);
  }

  stop(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      console.log(`[WheelStrategyScheduler] Stopped job for strategy ${id}`);
    }
    this.jobs.clear();
  }

  registerJob(strategyId: string, intervalHours: number | null, cronExpression: string | null): void {
    // Remove existing job if any
    this.removeJob(strategyId);

    const expr = cronExpression ?? this.intervalToCron(intervalHours);
    if (!expr) return;

    if (!cron.validate(expr)) {
      console.error(`[WheelStrategyScheduler] Invalid cron expression for strategy ${strategyId}: ${expr}`);
      return;
    }

    const task = cron.schedule(expr, async () => {
      console.log(`[WheelStrategyScheduler] Triggering scan for strategy ${strategyId}`);
      try {
        await wheelStrategyService.startScan(strategyId);
      } catch (err) {
        console.error(`[WheelStrategyScheduler] Failed to start scan for ${strategyId}:`, err);
      }
      // Update nextRunAt for UI after each run
      this.updateNextRunAt(strategyId, expr).catch(() => {});
    }, { timezone: "America/New_York" });

    this.jobs.set(strategyId, task);
    console.log(`[WheelStrategyScheduler] Registered job for strategy ${strategyId}: ${expr}`);

    // Update nextRunAt
    this.updateNextRunAt(strategyId, expr).catch(() => {});
  }

  removeJob(strategyId: string): void {
    const existing = this.jobs.get(strategyId);
    if (existing) {
      existing.stop();
      this.jobs.delete(strategyId);
    }
  }

  /**
   * Convert interval hours to a cron expression that runs during US market hours.
   * Market hours: 9:30 AM - 4:00 PM ET, weekdays.
   */
  private intervalToCron(intervalHours: number | null): string | null {
    if (!intervalHours || intervalHours <= 0) return null;

    const marketStart = 10; // 10:00 ET (close to 9:30 open)
    const marketEnd = 16; // 4:00 PM ET
    const hours: number[] = [];

    for (let h = marketStart; h <= marketEnd; h += intervalHours) {
      hours.push(Math.floor(h));
    }

    if (hours.length === 0) hours.push(marketStart);

    const unique = [...new Set(hours)];
    return `0 ${unique.join(",")} * * 1-5`;
  }

  async updateNextRunAt(strategyId: string, cronExpr: string): Promise<void> {
    try {
      const expr = CronExpressionParser.parse(cronExpr, {
        tz: "America/New_York",
      });
      const nextRun = expr.next().toDate();
      await prisma.wheelStrategy.update({
        where: { id: strategyId },
        data: { nextRunAt: nextRun },
      });
    } catch {
      // non-critical
    }
  }
}

export const wheelStrategyScheduler = new WheelStrategyScheduler();
