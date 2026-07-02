import type { CalendarEvent } from "@assup/shared";
import { isToday } from "./calendarUtils";
import { EventRow } from "./EventRow";

interface AgendaPanelProps {
  selectedDate: string | null;
  events: CalendarEvent[];
  allEvents: CalendarEvent[];
}

export function AgendaPanel({ selectedDate, events, allEvents }: AgendaPanelProps) {
  const selectedEvents = selectedDate
    ? events.filter((e) => e.date === selectedDate)
    : [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const upcoming = allEvents
    .filter((e) => e.date >= todayStr && e.date !== selectedDate)
    .slice(0, 10);

  const upcomingByDate = new Map<string, CalendarEvent[]>();
  for (const event of upcoming) {
    if (!upcomingByDate.has(event.date)) upcomingByDate.set(event.date, []);
    upcomingByDate.get(event.date)!.push(event);
  }

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    if (dateStr === todayStr) return `Today, ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <div className="border rounded-xl shadow-sm flex flex-col h-full">
      {selectedDate && (
        <div className="p-4 pb-3">
          <div className="text-sm font-semibold">
            {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          {isToday(selectedDate) && (
            <div className="text-xs text-muted-foreground">Today</div>
          )}
        </div>
      )}
      {selectedDate && (
        <div className="px-4 pb-3">
          {selectedEvents.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No events</div>
          ) : (
            <div className="space-y-1">
              {selectedEvents.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-t p-4 pb-3">
        <div className="text-sm font-semibold">Upcoming</div>
      </div>
      <div className="px-4 pb-4 flex-1 overflow-y-auto space-y-1">
        {Array.from(upcomingByDate.entries()).map(([date, dateEvents]) => (
          <div key={date}>
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider py-1.5">
              {formatDateHeader(date)}
            </div>
            {dateEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        ))}
        {upcoming.length === 0 && (
          <div className="text-xs text-muted-foreground py-2">No upcoming events</div>
        )}
      </div>

      <div className="border-t px-4 py-2.5 flex flex-wrap gap-2.5">
        {[
          { label: "Expirations", color: "#2563eb" },
          { label: "Earnings/Div", color: "#d97706" },
          { label: "FOMC", color: "#dc2626" },
          { label: "Macro", color: "#16a34a" },
          { label: "Corporate", color: "#7c3aed" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
