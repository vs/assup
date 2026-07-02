import { readFileSync } from "fs";
import { join } from "path";
import type { CalendarEventType } from "@assup/shared";

interface MacroDate {
  date: string;
  title: string;
}

type MacroCalendarData = Record<string, Record<string, MacroDate[]>>;

let cachedData: MacroCalendarData | null = null;

function loadCalendarData(): MacroCalendarData {
  if (cachedData) return cachedData;
  const filePath = join(import.meta.dirname, "../data", "macro-calendar-2026.json");
  cachedData = JSON.parse(readFileSync(filePath, "utf-8")) as MacroCalendarData;
  return cachedData;
}

export function getMacroEvents(
  year: number
): Array<{ date: string; title: string; eventType: CalendarEventType }> {
  const data = loadCalendarData();
  const yearData = data[String(year)];
  if (!yearData) return [];

  const events: Array<{ date: string; title: string; eventType: CalendarEventType }> = [];
  for (const [type, dates] of Object.entries(yearData)) {
    for (const entry of dates) {
      events.push({
        date: entry.date,
        title: entry.title,
        eventType: type as CalendarEventType,
      });
    }
  }
  return events;
}
