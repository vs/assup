import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { taxesApi } from "@/api/taxes";
import type { TaxDividend, DividendsByCountry } from "@assup/shared";

interface Props {
  year: number;
}

export function DividendsTable({ year }: Props) {
  const [dividends, setDividends] = useState<TaxDividend[]>([]);
  const [byCountry, setByCountry] = useState<DividendsByCountry[]>([]);
  const [totals, setTotals] = useState({ gross: 0, withholdingTax: 0, net: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await taxesApi.dividends(year);
        setDividends(data.dividends);
        setByCountry(data.byCountry);
        setTotals(data.totals);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [year]);

  const formatCzk = (value: number) =>
    new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 0,
    }).format(value);

  const formatUsd = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Loading dividends...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* By Country Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Dividends by Country (§8 - Kapitálový majetek)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Gross (CZK)</TableHead>
                  <TableHead className="text-right">W/H Tax (CZK)</TableHead>
                  <TableHead className="text-right">Net (CZK)</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCountry.map((row) => (
                  <TableRow key={row.country}>
                    <TableCell className="font-medium">{row.country}</TableCell>
                    <TableCell className="text-right">
                      {formatCzk(row.gross)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCzk(row.withholdingTax)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCzk(row.net)}
                    </TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold bg-muted/50">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">
                    {formatCzk(totals.gross)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCzk(totals.withholdingTax)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCzk(totals.net)}
                  </TableCell>
                  <TableCell className="text-right">
                    {dividends.length}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle>Dividend Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">W/H Tax</TableHead>
                  <TableHead className="text-right">Net (CZK)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dividends.map((div) => (
                  <TableRow key={div.id}>
                    <TableCell>{div.date}</TableCell>
                    <TableCell className="font-medium">{div.symbol}</TableCell>
                    <TableCell>{div.country}</TableCell>
                    <TableCell className="text-right">
                      <div>{formatCzk(div.grossCzk)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatUsd(div.grossUsd)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div>{formatCzk(div.withholdingTaxCzk)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatUsd(div.withholdingTaxUsd)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {formatCzk(div.netCzk)}
                    </TableCell>
                  </TableRow>
                ))}
                {dividends.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No dividends found for {year}
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
