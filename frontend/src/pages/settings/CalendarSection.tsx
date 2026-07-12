import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calendarApi } from "@/api/calendar";
import type { CalendarEventType, WeekStartDay } from "@assup/shared";

const EVENT_GROUPS = [
  {
    label: "Earnings & Dividends",
    types: ["EARNINGS", "DIVIDEND_ANNOUNCED", "DIVIDEND_EX_DATE", "DIVIDEND_PAYMENT"] as CalendarEventType[],
  },
  {
    label: "FOMC",
    types: ["FOMC"] as CalendarEventType[],
  },
  {
    label: "Macro",
    types: ["CPI", "GDP", "JOBS_REPORT", "FED_SPEECH"] as CalendarEventType[],
  },
  {
    label: "Corporate Actions",
    types: ["STOCK_SPLIT", "MERGER", "SEC_FILING"] as CalendarEventType[],
  },
];

const TYPE_LABELS: Record<CalendarEventType, string> = {
  OPTION_EXPIRATION: "Option Expirations",
  EARNINGS: "Earnings Reports",
  DIVIDEND_ANNOUNCED: "Dividend Announcements",
  DIVIDEND_EX_DATE: "Ex-Dividend Dates",
  DIVIDEND_PAYMENT: "Dividend Payments",
  FOMC: "FOMC Meetings",
  CPI: "CPI Releases",
  GDP: "GDP Reports",
  JOBS_REPORT: "Jobs Reports",
  FED_SPEECH: "Fed Speeches",
  STOCK_SPLIT: "Stock Splits",
  MERGER: "Mergers & Acquisitions",
  SEC_FILING: "SEC Filings",
};

export function CalendarSection() {
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["calendar", "settings"],
    queryFn: () => calendarApi.getSettings(),
  });

  const mutation = useMutation({
    mutationFn: calendarApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  const excluded = settings?.excludedEventTypes ?? [];
  const excludeSpreadExpirations = settings?.excludeSpreadExpirations ?? false;
  const weekStartDay = settings?.weekStartDay ?? "monday";

  const save = (patch: Partial<{ excludedEventTypes: CalendarEventType[]; excludeSpreadExpirations: boolean; weekStartDay: WeekStartDay }>) => {
    mutation.mutate({ excludedEventTypes: excluded, excludeSpreadExpirations, weekStartDay, ...patch });
  };

  const toggleType = (type: CalendarEventType) => {
    const newExcluded = excluded.includes(type)
      ? excluded.filter((t) => t !== type)
      : [...excluded, type];
    save({ excludedEventTypes: newExcluded });
  };

  const toggleSpreadExpirations = () => {
    save({ excludeSpreadExpirations: !excludeSpreadExpirations });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Calendar Events</CardTitle>
        <p className="text-xs text-muted-foreground">Choose which event types appear in the calendar, dashboard, and ticker pages.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Week Start
          </div>
          <div className="flex gap-2 px-2">
            {([["monday", "Monday"], ["sunday", "Sunday"]] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => save({ weekStartDay: value })}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  weekStartDay === value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Expirations
          </div>
          <div className="space-y-1">
            <label className="flex items-start gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                checked={!excluded.includes("OPTION_EXPIRATION")}
                onChange={() => toggleType("OPTION_EXPIRATION")}
                className="rounded border-input mt-0.5"
              />
              <div>
                <span className="text-sm">Option expirations</span>
                <p className="text-xs text-muted-foreground">Expiration dates for open option contracts in your portfolio (puts and calls you hold)</p>
              </div>
            </label>
            <label className="flex items-start gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                checked={!excludeSpreadExpirations}
                onChange={toggleSpreadExpirations}
                className="rounded border-input mt-0.5"
              />
              <div>
                <span className="text-sm">Spread expirations</span>
                <p className="text-xs text-muted-foreground">Expiration dates for spread positions (SPX, XSP, RUT)</p>
              </div>
            </label>
          </div>
        </div>

        {EVENT_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.types.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!excluded.includes(type)}
                    onChange={() => toggleType(type)}
                    className="rounded border-input"
                  />
                  <span className="text-sm">{TYPE_LABELS[type]}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

      </CardContent>
    </Card>
  );
}
