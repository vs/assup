import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  XCircle,
  Key,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const [purging, setPurging] = useState(false);
  const purgeMutation = useMutation({
    mutationFn: () => calendarApi.purge(),
    onMutate: () => setPurging(true),
    onSettled: () => setPurging(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
  });

  // Finnhub API key management
  const { data: finnhubStatus } = useQuery({
    queryKey: ["calendar", "finnhub-auth"],
    queryFn: () => calendarApi.getFinnhubAuthStatus(),
  });
  const [finnhubKeyInput, setFinnhubKeyInput] = useState("");
  const [finnhubSaveSuccess, setFinnhubSaveSuccess] = useState(false);
  const [finnhubTestResult, setFinnhubTestResult] = useState<
    { ok: boolean; message?: string } | null
  >(null);

  const finnhubSaveMutation = useMutation({
    mutationFn: (key: string) => calendarApi.setFinnhubApiKey(key),
    onSuccess: () => {
      setFinnhubKeyInput("");
      setFinnhubSaveSuccess(true);
      setFinnhubTestResult(null);
      setTimeout(() => setFinnhubSaveSuccess(false), 3000);
      queryClient.invalidateQueries({ queryKey: ["calendar", "finnhub-auth"] });
    },
  });

  const finnhubDeleteMutation = useMutation({
    mutationFn: () => calendarApi.deleteFinnhubApiKey(),
    onSuccess: () => {
      setFinnhubTestResult(null);
      queryClient.invalidateQueries({ queryKey: ["calendar", "finnhub-auth"] });
    },
  });

  const finnhubTestMutation = useMutation({
    mutationFn: () => calendarApi.testFinnhub(),
    onSuccess: (result) => setFinnhubTestResult(result),
    onError: (err) =>
      setFinnhubTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "test failed",
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Calendar</CardTitle>
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

        <div className="border-t pt-4">
          <div className="text-sm font-semibold mb-0.5">Calendar Events</div>
          <p className="text-xs text-muted-foreground mb-3">Choose which event types appear in the calendar, dashboard, and ticker pages.</p>
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

        <div className="border-t pt-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" />
            Finnhub API Key
          </div>
          <p className="text-xs text-muted-foreground mb-3 px-2">
            Used to fetch earnings announcement dates. Get a free key at{" "}
            <a
              href="https://finnhub.io/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              finnhub.io
            </a>{" "}
            (60 calls/minute on the free tier).
          </p>

          <div className="space-y-3 px-2">
            {finnhubStatus && (
              <div className="flex items-center gap-2">
                {finnhubStatus.configured ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    <div className="text-sm">
                      Configured
                      <span className="text-muted-foreground ml-1">
                        ({finnhubStatus.source === "database"
                          ? "saved in database"
                          : "from environment"})
                      </span>
                      {finnhubStatus.maskedKey && (
                        <span className="ml-2 text-xs text-muted-foreground font-mono">
                          {finnhubStatus.maskedKey}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <span className="text-sm">Not configured — earnings will not sync</span>
                  </>
                )}
              </div>
            )}

            {finnhubTestResult && (
              <div className="flex items-center gap-2">
                {finnhubTestResult.ok ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Key is valid — Finnhub responded OK</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">
                      Test failed
                      {finnhubTestResult.message ? ` — ${finnhubTestResult.message}` : ""}
                    </span>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="finnhub-api-key" className="text-xs">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="finnhub-api-key"
                  type="password"
                  placeholder="Enter your Finnhub API key"
                  value={finnhubKeyInput}
                  onChange={(e) => setFinnhubKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && finnhubKeyInput.trim()) {
                      finnhubSaveMutation.mutate(finnhubKeyInput.trim());
                    }
                  }}
                  className="max-w-sm"
                />
                <Button
                  size="sm"
                  onClick={() => finnhubSaveMutation.mutate(finnhubKeyInput.trim())}
                  disabled={finnhubSaveMutation.isPending || !finnhubKeyInput.trim()}
                >
                  {finnhubSaveMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => finnhubTestMutation.mutate()}
                  disabled={finnhubTestMutation.isPending || !finnhubStatus?.configured}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-1.5 ${finnhubTestMutation.isPending ? "animate-spin" : ""}`}
                  />
                  Test
                </Button>
                {finnhubStatus?.source === "database" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => finnhubDeleteMutation.mutate()}
                    disabled={finnhubDeleteMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-1.5" />
                    Remove
                  </Button>
                )}
              </div>
              {finnhubSaveSuccess && (
                <p className="text-xs text-green-600">API key saved</p>
              )}
              {finnhubSaveMutation.isError && (
                <p className="text-xs text-red-500">
                  {finnhubSaveMutation.error instanceof Error
                    ? finnhubSaveMutation.error.message
                    : "Failed to save"}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Data
          </div>
          <div className="flex items-center gap-3 px-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => purgeMutation.mutate()}
              disabled={purging}
            >
              {purging ? "Purging..." : "Purge & Resync Events"}
            </Button>
            <span className="text-xs text-muted-foreground">Delete all cached events and resync from scratch. Removes stale events from tickers no longer in your portfolio.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
