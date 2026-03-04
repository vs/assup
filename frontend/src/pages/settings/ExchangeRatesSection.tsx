import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageLoadingSkeleton, ErrorAlert } from "@/components/common";
import { exchangeRatesApi } from "@/api/exchangeRates";
import type { ExchangeRateStatus } from "@assup/shared";

interface RateEntry {
  date: string;
  currency: string;
  rate: number;
}

export function ExchangeRatesSection() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [status, setStatus] = useState<ExchangeRateStatus | null>(null);
  const [rates, setRates] = useState<RateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);

  const availableYears = Array.from({ length: 10 }, (_, i) => currentYear - i);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statusData, ratesData] = await Promise.all([
        exchangeRatesApi.getStatus(selectedYear),
        exchangeRatesApi.getRates(selectedYear),
      ]);
      setStatus(statusData);
      setRates(ratesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFetch = async () => {
    setFetching(true);
    setFetchResult(null);
    try {
      const result = await exchangeRatesApi.fetchRates(
        `${selectedYear}-01-01`,
        `${selectedYear}-12-31`,
        ["USD", "EUR"]
      );
      setFetchResult(`Fetched ${result.fetched} days, skipped ${result.skipped}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setFetching(false);
    }
  };

  // Pivot rates by date for table display
  const pivotRates = () => {
    const dateMap = new Map<string, Record<string, number>>();
    const currencies = new Set<string>();

    for (const rate of rates) {
      currencies.add(rate.currency);
      if (!dateMap.has(rate.date)) {
        dateMap.set(rate.date, {});
      }
      dateMap.get(rate.date)![rate.currency] = rate.rate;
    }

    return {
      currencies: Array.from(currencies).sort(),
      dates: Array.from(dateMap.keys()).sort().reverse(),
      dateMap,
    };
  };

  if (loading) return <PageLoadingSkeleton />;

  const { currencies, dates, dateMap } = pivotRates();

  return (
    <div className="space-y-6 py-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Exchange Rates</h2>
        <div className="flex items-center gap-4">
          <Select
            value={selectedYear.toString()}
            onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleFetch} disabled={fetching}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${fetching ? "animate-spin" : ""}`}
            />
            Fetch Rates
          </Button>
        </div>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {fetchResult && (
        <Alert>
          <AlertDescription>{fetchResult}</AlertDescription>
        </Alert>
      )}

      {status && (
        <Card>
          <CardHeader>
            <CardTitle>Status for {selectedYear}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-sm text-muted-foreground">
                  Trading Days Loaded
                </div>
                <div className="text-2xl font-bold">
                  {status.loadedDays} / {status.totalTradingDays}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Currencies</div>
                <div className="text-2xl font-bold">
                  {status.currencies.join(", ") || "None"}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">
                  Missing Dates
                </div>
                <div className="text-2xl font-bold">
                  {status.missingDates.length}
                </div>
              </div>
            </div>

            {status.missingDates.length > 0 &&
              status.missingDates.length <= 10 && (
                <div className="mt-4 text-sm text-muted-foreground">
                  Missing: {status.missingDates.join(", ")}
                </div>
              )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Exchange Rates (CNB)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border max-h-[600px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 bg-background">
                    Date
                  </TableHead>
                  {currencies.map((c) => (
                    <TableHead
                      key={c}
                      className="text-right sticky top-0 bg-background"
                    >
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dates.map((date) => (
                  <TableRow key={date}>
                    <TableCell>{date}</TableCell>
                    {currencies.map((c) => (
                      <TableCell key={c} className="text-right font-mono">
                        {dateMap.get(date)?.[c]?.toFixed(4) || "\u2014"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {dates.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={currencies.length + 1}
                      className="text-center py-8"
                    >
                      No exchange rates loaded for {selectedYear}. Click "Fetch
                      Rates" to load from CNB.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
