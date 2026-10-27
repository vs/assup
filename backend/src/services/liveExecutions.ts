import type { ImportedTrade } from "@prisma/client";
import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";

/**
 * TWS keeps reporting executions after the FLEX import has stored them — e.g. an
 * assignment booked at 22:00 ET is still in the execution list the next morning.
 * The two can't be matched by id (FLEX TradeID vs TWS execId), so live executions
 * on any day the FLEX data already covers are dropped. FLEX activity reports are
 * end-of-day, so a day with imported trades is a complete day.
 */
export function excludeExecutionsCoveredByFlex(
  executions: ImportedTrade[],
  flexCoveredThrough: Date | null
): ImportedTrade[] {
  if (!flexCoveredThrough) return executions;
  // FLEX trade_date is a DATE (UTC midnight); TWS tradeDate is built from the
  // execution's wall-clock fields in local time — compare each in its own frame.
  const coveredKey = flexCoveredThrough.toISOString().split("T")[0];
  return executions.filter((t) => localDateKey(t.tradeDate) > coveredKey);
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Today's TWS executions that are not yet in the FLEX-imported trades.
 */
export async function getUnimportedTodayTrades(secTypeFilter?: "OPT" | "STK"): Promise<ImportedTrade[]> {
  const executions = await ibkrService.getTodayTrades(secTypeFilter);
  if (executions.length === 0) return executions;
  const { _max } = await prisma.importedTrade.aggregate({ _max: { tradeDate: true } });
  return excludeExecutionsCoveredByFlex(executions, _max.tradeDate);
}
