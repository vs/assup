import type { CalendarEvent, CalendarSettings } from "@assup/shared";
import { request, buildQuery } from "./client";

interface CalendarQueryParams {
  start: string;
  end: string;
  types?: string;
  symbol?: string;
}

export const calendarApi = {
  getEvents(params: CalendarQueryParams): Promise<CalendarEvent[]> {
    const query = buildQuery(params);
    return request<CalendarEvent[]>(`/api/calendar${query}`);
  },

  getToday(days?: number): Promise<CalendarEvent[]> {
    const query = buildQuery({ days });
    return request<CalendarEvent[]>(`/api/calendar/today${query}`);
  },

  getTickerEvents(symbol: string, limit?: number): Promise<CalendarEvent[]> {
    const query = buildQuery({ limit });
    return request<CalendarEvent[]>(`/api/calendar/ticker/${symbol}${query}`);
  },

  sync(): Promise<{ success: boolean }> {
    return request<{ success: boolean }>("/api/calendar/sync", { method: "POST" });
  },

  getSettings(): Promise<CalendarSettings> {
    return request<CalendarSettings>("/api/calendar/settings");
  },

  updateSettings(settings: CalendarSettings): Promise<{ success: boolean }> {
    return request<{ success: boolean }>("/api/calendar/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  },
};
