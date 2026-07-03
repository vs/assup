import type { CalendarEventType } from "@assup/shared";
import macroData from "../data/macro-calendar-2026.json" with { type: "json" };

type MacroCalendarData = Record<string, Record<string, { date: string; title: string }[]>>;

const data = macroData as MacroCalendarData;

export function getMacroEvents(
  year: number
): Array<{ date: string; title: string; eventType: CalendarEventType }> {
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
