import { Clock, Moon, Sun, type LucideIcon } from "lucide-react";
import { EVENT_SESSION_LABEL, getEventSession } from "@assup/shared";
import type { CalendarEvent, CalendarEventSession } from "@assup/shared";

const SESSION_ICON: Record<CalendarEventSession, LucideIcon> = {
  before_open: Sun,
  during_market: Clock,
  after_close: Moon,
};

interface SessionMarkerProps {
  event: CalendarEvent;
  className?: string;
}

/** Sun / clock / moon for before open / during market / after close. */
export function SessionMarker({ event, className = "w-3 h-3" }: SessionMarkerProps) {
  const session = getEventSession(event);
  if (!session) return null;

  const Icon = SESSION_ICON[session];
  const label = EVENT_SESSION_LABEL[session];

  return (
    <span role="img" aria-label={label} title={label} className="inline-flex flex-shrink-0">
      <Icon className={className} aria-hidden />
    </span>
  );
}
