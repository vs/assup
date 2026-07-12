import { prisma } from "../db/index.js";
import type {
  AccountHistoryResponse,
  AccountHistoryGranularity,
} from "@assup/shared";

class AccountHistoryService {
  async getHistory(
    from?: string,
    to?: string,
    granularity?: AccountHistoryGranularity
  ): Promise<AccountHistoryResponse> {
    const effectiveFrom = from ? new Date(from) : undefined;
    const effectiveTo = to ? new Date(to) : new Date();

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (effectiveFrom) dateFilter.gte = effectiveFrom;
    if (effectiveTo) dateFilter.lte = effectiveTo;

    const whereClause = Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};

    const rawSnapshots = await prisma.accountSnapshot.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
      select: { date: true, netLiquidation: true },
    });

    const resolvedGranularity = granularity || this.autoGranularity(rawSnapshots);
    const snapshots = this.aggregateSnapshots(rawSnapshots, resolvedGranularity);

    const fundFlows = await prisma.fundFlow.findMany({
      where: whereClause,
      orderBy: { date: "asc" },
      select: { date: true, type: true, amount: true, currency: true, description: true },
    });

    return {
      snapshots: snapshots.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        netLiquidation: s.netLiquidation,
      })),
      fundFlows: fundFlows.map((f) => ({
        date: f.date.toISOString().split("T")[0],
        type: f.type as "DEPOSIT" | "WITHDRAWAL",
        amount: f.amount,
        currency: f.currency,
        description: f.description,
      })),
    };
  }

  private autoGranularity(snapshots: Array<{ date: Date }>): AccountHistoryGranularity {
    if (snapshots.length === 0) return "daily";
    const first = snapshots[0].date.getTime();
    const last = snapshots[snapshots.length - 1].date.getTime();
    const months = (last - first) / (1000 * 60 * 60 * 24 * 30);
    if (months < 6) return "daily";
    if (months < 24) return "weekly";
    return "monthly";
  }

  private aggregateSnapshots(
    snapshots: Array<{ date: Date; netLiquidation: number }>,
    granularity: AccountHistoryGranularity
  ): Array<{ date: Date; netLiquidation: number }> {
    if (granularity === "daily" || snapshots.length === 0) return snapshots;
    const groups = new Map<string, { date: Date; netLiquidation: number }>();
    for (const snap of snapshots) {
      const key = granularity === "weekly" ? this.weekKey(snap.date) : this.monthKey(snap.date);
      groups.set(key, snap);
    }
    return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private weekKey(date: Date): string {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().split("T")[0];
  }

  private monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
}

export const accountHistoryService = new AccountHistoryService();
