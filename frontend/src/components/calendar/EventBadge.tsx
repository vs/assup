import type { CalendarEvent } from "@assup/shared";
import { getEventColor } from "./calendarUtils";

interface EventBadgeProps {
  event: CalendarEvent;
}

export function EventBadge({ event }: EventBadgeProps) {
  const color = getEventColor(event.eventType);
  return (
    <div
      className="text-[10px] px-1.5 py-px rounded truncate border mt-0.5"
      style={{
        backgroundColor: `${color}15`,
        color: color,
        borderColor: `${color}30`,
      }}
    >
      {event.title}
    </div>
  );
}
