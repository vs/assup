import { Link } from "react-router-dom";
import type { CalendarEvent } from "@assup/shared";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { getEventColor } from "./calendarUtils";
import { SessionMarker } from "./SessionMarker";

interface EventBadgeProps {
  event: CalendarEvent;
}

export function EventBadge({ event }: EventBadgeProps) {
  const color = getEventColor(event.eventType);

  return (
    <div
      className={`flex items-center gap-1 text-[10px] px-1.5 py-px rounded border mt-0.5 ${
        event.marketWide ? "opacity-70" : ""
      }`}
      style={{
        // Market-wide events are context, not positions: hollow rather than
        // filled so a heavy earnings week cannot drown out held tickers.
        backgroundColor: event.marketWide ? "transparent" : `${color}15`,
        color: color,
        borderColor: `${color}30`,
      }}
    >
      {/* Ahead of the title so truncation can never hide it. */}
      <SessionMarker event={event} className="w-2.5 h-2.5" />
      {event.symbol ? (
        <TickerHoverCard symbol={event.symbol}>
          <Link to={`/tickers/${event.symbol}`} className="truncate min-w-0 hover:underline">
            {event.title}
          </Link>
        </TickerHoverCard>
      ) : (
        <span className="truncate min-w-0">{event.title}</span>
      )}
    </div>
  );
}
