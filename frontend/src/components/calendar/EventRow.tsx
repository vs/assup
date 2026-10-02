import { Link } from "react-router-dom";
import { EVENT_SESSION_LABEL, getEventSession } from "@assup/shared";
import type { CalendarEvent } from "@assup/shared";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { getEventColor } from "./calendarUtils";
import { SessionMarker } from "./SessionMarker";

interface EventRowProps {
  event: CalendarEvent;
}

export function EventRow({ event }: EventRowProps) {
  const color = getEventColor(event.eventType);
  const session = getEventSession(event);
  const subtitle = [session && EVENT_SESSION_LABEL[session], buildSubtitle(event)]
    .filter(Boolean)
    .join(" · ");

  // Extract the symbol prefix from the title so we can make just that part interactive
  const symbol = event.symbol;
  const titleAfterSymbol = symbol && event.title.startsWith(symbol)
    ? event.title.slice(symbol.length)
    : null;

  return (
    <div className="flex items-center gap-2.5 border rounded-md px-3 py-2 transition-colors">
      <div
        className="w-[3px] h-7 rounded-sm flex-shrink-0"
        style={
          event.marketWide
            ? { border: `1px solid ${color}`, backgroundColor: "transparent" }
            : { backgroundColor: color }
        }
      />
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-medium truncate ${
            event.marketWide ? "text-muted-foreground" : ""
          }`}
        >
          {symbol && titleAfterSymbol !== null ? (
            <>
              <TickerHoverCard symbol={symbol}>
                <Link
                  to={`/tickers/${symbol}`}
                  className="font-semibold hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {symbol}
                </Link>
              </TickerHoverCard>
              {titleAfterSymbol}
            </>
          ) : (
            event.title
          )}
        </div>
        {subtitle && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <SessionMarker event={event} />
            <span className="truncate min-w-0">{subtitle}</span>
          </div>
        )}
      </div>
    </div>
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
    case "OPTION_EXPIRATION": {
      const qty = details.quantity as number;
      const abs = Math.abs(qty);
      const label = `${abs} contract${abs !== 1 ? "s" : ""}`;
      return qty < 0 ? `${label} sold` : label;
    }
    case "STOCK_SPLIT":
      return `${details.splitTo}:${details.splitFrom} split`;
    default:
      return "";
  }
}
