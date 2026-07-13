import { Link } from "react-router-dom";
import type { CalendarEvent } from "@assup/shared";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { getEventColor } from "./calendarUtils";

interface EventRowProps {
  event: CalendarEvent;
}

export function EventRow({ event }: EventRowProps) {
  const color = getEventColor(event.eventType);
  const subtitle = buildSubtitle(event);

  const content = (
    <div className="flex items-center gap-2.5 border rounded-md px-3 py-2 hover:bg-muted/50 transition-colors">
      <div
        className="w-[3px] h-7 rounded-sm flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{event.title}</div>
        {subtitle && (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
    </div>
  );

  if (!event.symbol) return content;

  return (
    <TickerHoverCard symbol={event.symbol}>
      <Link to={`/tickers/${event.symbol}`} className="block">
        {content}
      </Link>
    </TickerHoverCard>
  );
}

function buildSubtitle(event: CalendarEvent): string {
  const details = event.details;
  if (!details) return "";

  switch (event.eventType) {
    case "EARNINGS":
      return details.estimateEps ? `EPS est. $${details.estimateEps}` : "";
    case "DIVIDEND_EX_DATE":
    case "DIVIDEND_PAYMENT":
      return details.amount ? `$${details.amount}/share · ${details.frequency || ""}` : "";
    case "OPTION_EXPIRATION":
      return `${details.quantity} contract${Math.abs(details.quantity as number) !== 1 ? "s" : ""}`;
    case "STOCK_SPLIT":
      return `${details.splitTo}:${details.splitFrom} split`;
    default:
      return "";
  }
}
