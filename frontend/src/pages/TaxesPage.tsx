import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Download, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, PageLoadingSkeleton, ErrorAlert } from "@/components/common";
import { taxesApi } from "@/api/taxes";
import { StockTradesTable } from "@/components/taxes/StockTradesTable";
import type { TaxSummary } from "@assup/shared";

export function TaxesPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const availableYears = Array.from({ length: 10 }, (_, i) => currentYear - i);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await taxesApi.summary(selectedYear);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tax data");
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = async () => {
    if (!summary?.canExport) return;
    setExporting(true);
    try {
      taxesApi.export(selectedYear);
    } finally {
      setExporting(false);
    }
  };

  const formatCzk = (value: number) =>
    new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 0,
    }).format(value);

  if (loading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader title="Taxes">
        <div className="flex items-center gap-4">
          <Link
            to="/settings/exchange-rates"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Exchange Rates
            <ExternalLink className="h-3 w-3" />
          </Link>
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
          <Button
            onClick={handleExport}
            disabled={!summary?.canExport || exporting}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </PageHeader>

      {error && <ErrorAlert message={error} />}

      {summary && !summary.canExport && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Missing trade records detected</AlertTitle>
          <AlertDescription>
            {summary.missingRecords.length} sell transactions have no matching
            buy record. Import the missing FLEX reports to complete your tax
            data.
          </AlertDescription>
        </Alert>
      )}

      {summary && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  §10 Securities (D - CP)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Income:</span>
                    <span>{formatCzk(summary.securities.income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expenses:</span>
                    <span>{formatCzk(summary.securities.expenses)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Profit:</span>
                    <span
                      className={
                        summary.securities.profit >= 0
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {formatCzk(summary.securities.profit)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  §10 Derivatives (F - Deriváty)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Income:</span>
                    <span>{formatCzk(summary.derivatives.income)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expenses:</span>
                    <span>{formatCzk(summary.derivatives.expenses)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Profit:</span>
                    <span
                      className={
                        summary.derivatives.profit >= 0
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {formatCzk(summary.derivatives.profit)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  §8 Dividends
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Gross:</span>
                    <span>{formatCzk(summary.dividends.gross)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>W/H Tax:</span>
                    <span>{formatCzk(summary.dividends.withholdingTax)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Net:</span>
                    <span className="text-green-600">
                      {formatCzk(summary.dividends.net)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="summary" className="space-y-4">
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="stocks">Stock Trades</TabsTrigger>
              <TabsTrigger value="options">Option Trades</TabsTrigger>
              <TabsTrigger value="dividends">Dividends</TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              <Card>
                <CardHeader>
                  <CardTitle>Tax Summary for {selectedYear}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">
                        Foreign Tax Credit by Country
                      </h4>
                      <div className="space-y-1">
                        {summary.dividends.byCountry.map((c) => (
                          <div
                            key={c.country}
                            className="flex justify-between text-sm"
                          >
                            <span>{c.country}</span>
                            <span>{formatCzk(c.withholdingTax)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {summary.missingRecords.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2 text-red-600">
                          Missing Records
                        </h4>
                        <div className="space-y-1">
                          {summary.missingRecords.map((r, i) => (
                            <div key={i} className="text-sm text-red-600">
                              {r.symbol} - {r.description}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="stocks">
              <StockTradesTab year={selectedYear} />
            </TabsContent>

            <TabsContent value="options">
              <OptionTradesTab year={selectedYear} />
            </TabsContent>

            <TabsContent value="dividends">
              <DividendsTab year={selectedYear} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// Tab components
function StockTradesTab({ year }: { year: number }) {
  return <StockTradesTable year={year} />;
}

function OptionTradesTab({ year }: { year: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground">
          Option trades for {year} - Loading...
        </p>
      </CardContent>
    </Card>
  );
}

function DividendsTab({ year }: { year: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground">
          Dividends for {year} - Loading...
        </p>
      </CardContent>
    </Card>
  );
}
