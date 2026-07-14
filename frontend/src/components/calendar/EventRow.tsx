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

  // Extract the symbol prefix from the title so we can make just that part interactive
  const symbol = event.symbol;
  const titleAfterSymbol = symbol && event.title.startsWith(symbol)
    ? event.title.slice(symbol.length)
    : null;

  return (
    <div className="flex items-center gap-2.5 border rounded-md px-3 py-2 transition-colors">
      <div
        className="w-[3px] h-7 rounded-sm flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
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
          <div className="text-xs text-muted-foreground">{subtitle}</div>
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
