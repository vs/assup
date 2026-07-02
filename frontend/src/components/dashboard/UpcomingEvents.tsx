import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calendarApi } from "@/api/calendar";
import { EventRow } from "@/components/calendar/EventRow";

export function UpcomingEvents() {
  const navigate = useNavigate();
  const { data: events = [] } = useQuery({
    queryKey: ["calendar", "today"],
    queryFn: () => calendarApi.getToday(5),
    refetchInterval: 5 * 60 * 1000,
  });

  const eventsByDate = new Map<string, typeof events>();
  for (const event of events) {
    if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
    eventsByDate.get(event.date)!.push(event);
  }

  const today = new Date().toISOString().split("T")[0];

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    if (dateStr === today) return `Today, ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <Card className="flex-1">
      <CardHeader className="pb-2 pt-4 px-4 flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Upcoming Events</CardTitle>
        <button
          onClick={() => navigate("/calendar")}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all →
        </button>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {Array.from(eventsByDate.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dateEvents]) => (
            <div key={date}>
              <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider py-1">
                {formatDateHeader(date)}
              </div>
              {dateEvents.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          ))}
        {events.length === 0 && (
          <div className="text-xs text-muted-foreground py-2">No upcoming events</div>
        )}
      </CardContent>
    </Card>
  );
}
