import { EVENT_TYPE_CATEGORY, EVENT_CATEGORY_COLOR } from "@assup/shared";
import type { CalendarEventType, CalendarEventCategory, WeekStartDay } from "@assup/shared";

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Get the offset of day 1 in the month grid (0-indexed from week start) */
export function getFirstDayOfMonth(year: number, month: number, weekStartDay: WeekStartDay = "monday"): number {
  const day = new Date(year, month, 1).getDay(); // 0=Sun, 1=Mon, ...
  if (weekStartDay === "monday") {
    return day === 0 ? 6 : day - 1;
  }
  return day; // Sunday-start: Sunday=0 is already correct
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getMonthStart(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function getMonthEnd(year: number, month: number): string {
  const lastDay = getDaysInMonth(year, month);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function getEventColor(eventType: CalendarEventType): string {
  const category = EVENT_TYPE_CATEGORY[eventType];
  return EVENT_CATEGORY_COLOR[category];
}

export function getEventCategory(eventType: CalendarEventType): CalendarEventCategory {
  return EVENT_TYPE_CATEGORY[eventType];
}

export function isToday(dateStr: string): boolean {
  return dateStr === formatDate(new Date());
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES_MONDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function getDayNames(weekStartDay: WeekStartDay = "monday"): string[] {
  return weekStartDay === "monday" ? DAY_NAMES_MONDAY : DAY_NAMES_SUNDAY;
}

/** For backward compat — default Monday start */
export const DAY_NAMES = DAY_NAMES_MONDAY;

/** Get the first day of the week containing the given date */
export function getWeekStart(date: Date, weekStartDay: WeekStartDay = "monday"): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  if (weekStartDay === "monday") {
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
  } else {
    d.setDate(d.getDate() - day);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get 7 dates starting from the week start */
export function getWeekDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return formatDate(d);
  });
}
