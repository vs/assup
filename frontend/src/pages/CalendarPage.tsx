import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { calendarApi } from "@/api/calendar";
import { PageHeader } from "@/components/common";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { AgendaPanel } from "@/components/calendar/AgendaPanel";
import { MonthYearPicker } from "@/components/calendar/MonthYearPicker";
import { EventRow } from "@/components/calendar/EventRow";
import { getMonthStart, getMonthEnd, formatDate } from "@/components/calendar/calendarUtils";

type ViewMode = "month" | "agenda";

export function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(formatDate(now));
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  const start = getMonthStart(year, month);
  const end = getMonthEnd(year, month);

  const { data: events = [] } = useQuery({
    queryKey: ["calendar", "events", start, end],
    queryFn: () => calendarApi.getEvents({ start, end }),
  });

  const handlePrevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };

  const handleNextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const handleToday = () => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth());
    setSelectedDate(formatDate(now));
  };

  const handleMonthYearChange = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
  };

  const eventsByDate = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const event of events) {
      if (!map.has(event.date)) map.set(event.date, []);
      map.get(event.date)!.push(event);
    }
    return map;
  }, [events]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Calendar" subtitle="Portfolio events and upcoming dates" />
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevMonth}
            className="inline-flex items-center justify-center bg-background border rounded-md px-2.5 py-1.5 text-sm shadow-xs hover:bg-accent transition-colors"
          >←</button>
          <MonthYearPicker year={year} month={month} onChange={handleMonthYearChange} />
          <button
            onClick={handleNextMonth}
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
              onClick={() => setViewMode("month")}
            >Month</button>
            <button
              className={`px-3.5 py-1.5 text-xs font-medium border-l transition-colors ${
                viewMode === "agenda"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("agenda")}
            >Agenda</button>
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
          />
          <AgendaPanel
            selectedDate={selectedDate}
            events={events}
            allEvents={events}
          />
        </div>
      ) : (
        <div className="border rounded-xl shadow-sm p-4 space-y-1">
          {Array.from(eventsByDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, dateEvents]) => (
              <div key={date}>
                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider py-1.5">
                  {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                <div className="space-y-1">
                  {dateEvents.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </div>
              </div>
            ))}
          {events.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">No events this month</div>
          )}
        </div>
      )}
    </div>
  );
}
