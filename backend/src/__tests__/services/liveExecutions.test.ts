import { describe, it, expect, vi } from "vitest";
import type { ImportedTrade } from "@prisma/client";

vi.mock("../../db/index.js", () => ({ prisma: {} }));
vi.mock("../../services/ibkr.js", () => ({ ibkrService: {} }));

import { excludeExecutionsCoveredByFlex } from "../../services/liveExecutions.js";

// TWS execution times carry no usable zone in our parser, so convertExecutionsToTrades
// builds tradeDate from the wall-clock fields in local time.
function liveExec(execId: string, year: number, month: number, day: number, hour: number): ImportedTrade {
  return {
    id: `tws-${execId}`,
    tradeId: execId,
    tradeDate: new Date(year, month - 1, day, hour, 15, 0),
  } as ImportedTrade;
}

// FLEX trade_date is a DATE column, which Prisma returns as UTC midnight.
const flexDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("excludeExecutionsCoveredByFlex", () => {
  // Regression for the QZAG early assignment: TWS still listed the previous
  // evening's assignment fills the next day, after the morning FLEX import had
  // already stored them. FLEX tradeIDs never equal TWS execIds, so the wheel
  // page showed the 100-share delivery (and the put close) twice.
  it("drops executions on a day the FLEX import already covers", () => {
    const execs = [liveExec("e1", 2026, 3, 16, 22)];
    expect(excludeExecutionsCoveredByFlex(execs, flexDate("2026-03-16"))).toEqual([]);
  });

  it("drops executions before the FLEX coverage date", () => {
    const execs = [liveExec("e1", 2026, 3, 13, 15)];
    expect(excludeExecutionsCoveredByFlex(execs, flexDate("2026-03-16"))).toEqual([]);
  });

  it("keeps executions after the FLEX coverage date", () => {
    const covered = liveExec("old", 2026, 3, 16, 22);
    const fresh = liveExec("new", 2026, 3, 17, 10);
    expect(excludeExecutionsCoveredByFlex([covered, fresh], flexDate("2026-03-16"))).toEqual([fresh]);
  });

  it("keeps every execution when nothing has been imported yet", () => {
    const execs = [liveExec("e1", 2026, 3, 17, 10)];
    expect(excludeExecutionsCoveredByFlex(execs, null)).toEqual(execs);
  });
});
