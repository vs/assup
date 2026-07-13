import { Link } from "react-router-dom";
import type { CalendarEvent } from "@assup/shared";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { getEventColor } from "./calendarUtils";

interface EventBadgeProps {
  event: CalendarEvent;
}

export function EventBadge({ event }: EventBadgeProps) {
  const color = getEventColor(event.eventType);

  const badge = (
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

  if (!event.symbol) return badge;

  return (
    <TickerHoverCard symbol={event.symbol}>
      <Link to={`/tickers/${event.symbol}`} className="block">
        {badge}
      </Link>
    </TickerHoverCard>
  );
}
