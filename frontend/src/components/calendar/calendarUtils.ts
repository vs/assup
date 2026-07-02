import { EVENT_TYPE_CATEGORY, EVENT_CATEGORY_COLOR } from "@assup/shared";
import type { CalendarEventType, CalendarEventCategory } from "@assup/shared";

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
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

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
