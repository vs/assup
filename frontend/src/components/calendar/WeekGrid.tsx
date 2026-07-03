import type { CalendarEvent } from "@assup/shared";
import { formatDate, DAY_NAMES, getWeekDates, getWeekStart } from "./calendarUtils";
import { EventRow } from "./EventRow";

interface WeekGridProps {
  weekStart: Date;
  events: CalendarEvent[];
}

export function WeekGrid({ weekStart, events }: WeekGridProps) {
  const dates = getWeekDates(weekStart);
  const today = formatDate(new Date());

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
    eventsByDate.get(event.date)!.push(event);
  }

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm">
      {/* 7-column day grid */}
      <div className="grid grid-cols-7">
        {dates.map((dateStr, i) => {
          const dayEvents = eventsByDate.get(dateStr) || [];
          const isToday = dateStr === today;
          const date = new Date(dateStr + "T12:00:00");
          const dayNum = date.getDate();

          return (
            <div
              key={dateStr}
              className={`flex flex-col border-r last:border-r-0 ${isToday ? "bg-muted/30" : ""}`}
            >
              {/* Day header */}
              <div className="border-b bg-muted/50 px-2 py-2 text-center">
                <div className="text-xs text-muted-foreground font-medium">{DAY_NAMES[i]}</div>
                <div className={`text-sm mt-0.5 ${isToday
                  ? "inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold"
                  : "font-medium"}`}
                >
                  {dayNum}
                </div>
              </div>

              {/* Events column */}
              <div className="p-1.5 space-y-1 min-h-[200px] flex-1 overflow-y-auto">
                {dayEvents.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
                {dayEvents.length === 0 && (
                  <div className="text-[10px] text-muted-foreground text-center py-4">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
