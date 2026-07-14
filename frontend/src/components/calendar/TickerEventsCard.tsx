import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calendarApi } from "@/api/calendar";
import { getEventColor, getEventCategory } from "./calendarUtils";
import type { CalendarEvent, CalendarEventCategory } from "@assup/shared";

const CATEGORY_LABELS: Record<CalendarEventCategory, string> = {
  expiration: "Expiration",
  earnings_dividend: "Earnings",
  fomc: "FOMC",
  macro: "Macro",
  corporate: "Corporate",
};

interface TickerEventsCardProps {
  symbol: string;
}

export function TickerEventsCard({ symbol }: TickerEventsCardProps) {
  const navigate = useNavigate();
  const { data: events = [] } = useQuery({
    queryKey: ["calendar", "ticker", symbol],
    queryFn: () => calendarApi.getTickerEvents(symbol),
  });

  if (events.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4 flex-row items-center justify-between border-b">
        <CardTitle className="text-sm font-semibold">Upcoming Events</CardTitle>
        <button
          onClick={() => navigate(`/calendar?symbol=${symbol}`)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View in calendar →
        </button>
      </CardHeader>
      <CardContent className="px-4 py-3">
        {events.map((event) => (
          <TickerEventRow key={event.id} event={event} />
        ))}
      </CardContent>
    </Card>
  );
}

function TickerEventRow({ event }: { event: CalendarEvent }) {
  const color = getEventColor(event.eventType);
  const category = getEventCategory(event.eventType);
  const date = new Date(event.date + "T12:00:00");
  const subtitle = buildSubtitle(event);

  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0">
      <div className="w-[3px] h-6 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <div className="w-20 flex-shrink-0">
        <div className="text-xs font-medium">
          {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {date.toLocaleDateString("en-US", { weekday: "short" })}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{event.title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      <div
        className="text-[10px] font-medium px-2 py-0.5 rounded-full border"
        style={{
          backgroundColor: `${color}15`,
          color: color,
          borderColor: `${color}30`,
        }}
      >
        {CATEGORY_LABELS[category]}
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
