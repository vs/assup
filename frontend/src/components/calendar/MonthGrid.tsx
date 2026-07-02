import type { CalendarEvent } from "@assup/shared";
import { getDaysInMonth, getFirstDayOfMonth, formatDate, DAY_NAMES } from "./calendarUtils";
import { EventBadge } from "./EventBadge";

interface MonthGridProps {
  year: number;
  month: number;
  events: CalendarEvent[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

export function MonthGrid({ year, month, events, selectedDate, onSelectDate }: MonthGridProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = formatDate(new Date());

  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.date;
    if (!eventsByDate.has(key)) eventsByDate.set(key, []);
    eventsByDate.get(key)!.push(event);
  }

  const cells: Array<{ day: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push({ day: null, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, dateStr });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, dateStr: null });
  }

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm">
      <div className="grid grid-cols-7 border-b bg-muted/50">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center py-2 text-xs text-muted-foreground font-medium">
            {name}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const dayEvents = cell.dateStr ? eventsByDate.get(cell.dateStr) || [] : [];
          const isToday = cell.dateStr === today;
          const isSelected = cell.dateStr === selectedDate;

          return (
            <div
              key={i}
              className={`min-h-[72px] p-1 border-b border-r last:border-r-0 cursor-pointer transition-colors ${
                isSelected ? "bg-muted/50" : ""
              } ${cell.day === null ? "bg-muted/20" : "hover:bg-muted/30"}`}
              onClick={() => cell.dateStr && onSelectDate(cell.dateStr)}
            >
              {cell.day !== null && (
                <>
                  <div className={`text-xs mb-0.5 ${isToday
                    ? "inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold"
                    : "text-muted-foreground"}`}
                  >
                    {cell.day}
                  </div>
                  {dayEvents.slice(0, 3).map((event) => (
                    <EventBadge key={event.id} event={event} />
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
