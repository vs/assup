import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WeekStartDay } from "@assup/shared";
import { calendarApi } from "@/api/calendar";
import { PageHeader } from "@/components/common";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { AgendaPanel } from "@/components/calendar/AgendaPanel";
import { MonthYearPicker } from "@/components/calendar/MonthYearPicker";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { getMonthStart, getMonthEnd, formatDate, getWeekStart, getWeekDates } from "@/components/calendar/calendarUtils";

type ViewMode = "month" | "week";

export function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(formatDate(now));
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [weekStartOverride, setWeekStartOverride] = useState<Date | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["calendar", "settings"],
    queryFn: () => calendarApi.getSettings(),
  });

  const weekStartDay: WeekStartDay = settings?.weekStartDay ?? "monday";

  // Compute actual week start from override or today
  const weekStart = weekStartOverride ?? getWeekStart(now, weekStartDay);

  // Data range depends on view mode
  const start = viewMode === "month" ? getMonthStart(year, month) : formatDate(weekStart);
  const end = viewMode === "month"
    ? getMonthEnd(year, month)
    : (() => { const d = new Date(weekStart); d.setDate(d.getDate() + 6); return formatDate(d); })();

  const { data: events = [] } = useQuery({
    queryKey: ["calendar", "events", start, end],
    queryFn: () => calendarApi.getEvents({ start, end }),
  });

  // Upcoming events for the agenda panel — extends 30 days beyond today
  // so the "Upcoming" section shows events past the current view range
  // (e.g. next FOMC when viewing the prior month).
  const todayStr = formatDate(now);
  const upcomingEnd = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + 30);
    return formatDate(d);
  })();
  const { data: upcomingEvents = [] } = useQuery({
    queryKey: ["calendar", "upcoming", todayStr, upcomingEnd],
    queryFn: () => calendarApi.getEvents({ start: todayStr, end: upcomingEnd }),
  });

  const handlePrev = () => {
    if (viewMode === "week") {
      const prev = new Date(weekStart);
      prev.setDate(prev.getDate() - 7);
      setWeekStartOverride(prev);
    } else {
      if (month === 0) { setMonth(11); setYear(year - 1); }
      else setMonth(month - 1);
    }
  };

  const handleNext = () => {
    if (viewMode === "week") {
      const next = new Date(weekStart);
      next.setDate(next.getDate() + 7);
      setWeekStartOverride(next);
    } else {
      if (month === 11) { setMonth(0); setYear(year + 1); }
      else setMonth(month + 1);
    }
  };

  const handleToday = () => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelectedDate(formatDate(now));
    setWeekStartOverride(getWeekStart(now, weekStartDay));
  };

  const handleMonthYearChange = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "week") {
      const target = selectedDate ? new Date(selectedDate + "T12:00:00") : new Date();
      setWeekStartOverride(getWeekStart(target, weekStartDay));
    } else {
      setYear(weekStart.getFullYear());
      setMonth(weekStart.getMonth());
    }
  };

  // Week label for header
  const weekDates = getWeekDates(weekStart);
  const weekLabel = (() => {
    const first = new Date(weekDates[0] + "T12:00:00");
    const last = new Date(weekDates[6] + "T12:00:00");
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (first.getMonth() === last.getMonth()) {
      return `${first.toLocaleDateString("en-US", opts)} – ${last.getDate()}`;
    }
    return `${first.toLocaleDateString("en-US", opts)} – ${last.toLocaleDateString("en-US", opts)}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Calendar" subtitle="Portfolio events and upcoming dates" />
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            className="inline-flex items-center justify-center bg-background border rounded-md px-2.5 py-1.5 text-sm shadow-xs hover:bg-accent transition-colors"
          >←</button>

          {viewMode === "month" ? (
            <MonthYearPicker year={year} month={month} onChange={handleMonthYearChange} />
          ) : (
            <span className="text-sm font-semibold px-3 py-1.5 min-w-[160px] text-center">{weekLabel}</span>
          )}

          <button
            onClick={handleNext}
            className="inline-flex items-center justify-center bg-background border rounded-md px-2.5 py-1.5 text-sm shadow-xs hover:bg-accent transition-colors"
          >→</button>
          <button
            onClick={handleToday}
            className="bg-background border rounded-md px-3 py-1.5 text-xs text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground transition-colors ml-1"
          >Today</button>
          <div className="inline-flex border rounded-md overflow-hidden shadow-xs ml-2">
            <button
              className={`px-3.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "month"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => handleViewModeChange("month")}
            >Month</button>
            <button
              className={`px-3.5 py-1.5 text-xs font-medium border-l transition-colors ${
                viewMode === "week"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => handleViewModeChange("week")}
            >Week</button>
          </div>
        </div>
      </div>

      {viewMode === "month" ? (
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
          <MonthGrid
            year={year}
            month={month}
            events={events}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            weekStartDay={weekStartDay}
          />
          <AgendaPanel
            selectedDate={selectedDate}
            events={events}
            allEvents={upcomingEvents}
          />
        </div>
      ) : (
        <WeekGrid weekStart={weekStart} events={events} weekStartDay={weekStartDay} />
      )}
    </div>
  );
}
