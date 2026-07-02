import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calendarApi } from "@/api/calendar";
import type { CalendarEventType } from "@assup/shared";

const EVENT_GROUPS = [
  {
    label: "Expirations",
    types: ["OPTION_EXPIRATION"] as CalendarEventType[],
  },
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

  const toggleType = (type: CalendarEventType) => {
    const newExcluded = excluded.includes(type)
      ? excluded.filter((t) => t !== type)
      : [...excluded, type];
    mutation.mutate({ excludedEventTypes: newExcluded });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Calendar Events</CardTitle>
        <p className="text-xs text-muted-foreground">Choose which event types appear in the calendar, dashboard, and ticker pages.</p>
      </CardHeader>
      <CardContent className="space-y-4">
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
