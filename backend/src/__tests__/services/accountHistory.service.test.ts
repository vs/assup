import { describe, it, expect } from "vitest";

function autoGranularity(snapshots: Array<{ date: Date }>): "daily" | "weekly" | "monthly" {
  if (snapshots.length === 0) return "daily";
  const first = snapshots[0].date.getTime();
  const last = snapshots[snapshots.length - 1].date.getTime();
  const months = (last - first) / (1000 * 60 * 60 * 24 * 30);
  if (months < 6) return "daily";
  if (months < 24) return "weekly";
  return "monthly";
}

function weekKey(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().split("T")[0];
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function aggregateSnapshots(
  snapshots: Array<{ date: Date; netLiquidation: number }>,
  granularity: "daily" | "weekly" | "monthly"
): Array<{ date: Date; netLiquidation: number }> {
  if (granularity === "daily" || snapshots.length === 0) return snapshots;
  const groups = new Map<string, { date: Date; netLiquidation: number }>();
  for (const snap of snapshots) {
    const key = granularity === "weekly" ? weekKey(snap.date) : monthKey(snap.date);
    groups.set(key, snap);
  }
  return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

describe("autoGranularity", () => {
  it("returns daily for empty snapshots", () => {
    expect(autoGranularity([])).toBe("daily");
  });

  it("returns daily for < 6 months range", () => {
    expect(autoGranularity([{ date: new Date("2024-01-01") }, { date: new Date("2024-04-01") }])).toBe("daily");
  });

  it("returns weekly for 6mo-2yr range", () => {
    expect(autoGranularity([{ date: new Date("2024-01-01") }, { date: new Date("2025-01-01") }])).toBe("weekly");
  });

  it("returns monthly for > 2yr range", () => {
    expect(autoGranularity([{ date: new Date("2022-01-01") }, { date: new Date("2025-01-01") }])).toBe("monthly");
  });
});

describe("aggregateSnapshots", () => {
  it("returns all points for daily granularity", () => {
    const snaps = [
      { date: new Date("2024-01-01"), netLiquidation: 100 },
      { date: new Date("2024-01-02"), netLiquidation: 101 },
    ];
    expect(aggregateSnapshots(snaps, "daily")).toHaveLength(2);
  });

  it("groups by week, keeping last snapshot per week", () => {
    const snaps = [
      { date: new Date("2024-01-01"), netLiquidation: 100 },
      { date: new Date("2024-01-03"), netLiquidation: 102 },
      { date: new Date("2024-01-08"), netLiquidation: 105 },
    ];
    const result = aggregateSnapshots(snaps, "weekly");
    expect(result).toHaveLength(2);
    expect(result[0].netLiquidation).toBe(102);
    expect(result[1].netLiquidation).toBe(105);
  });

  it("groups by month, keeping last snapshot per month", () => {
    const snaps = [
      { date: new Date("2024-01-15"), netLiquidation: 100 },
      { date: new Date("2024-01-31"), netLiquidation: 110 },
      { date: new Date("2024-02-15"), netLiquidation: 120 },
    ];
    const result = aggregateSnapshots(snaps, "monthly");
    expect(result).toHaveLength(2);
    expect(result[0].netLiquidation).toBe(110);
    expect(result[1].netLiquidation).toBe(120);
  });
});
