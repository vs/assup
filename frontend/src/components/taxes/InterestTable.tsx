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
import type { TaxInterest } from "@assup/shared";
import { formatCzk, formatUsd } from "./formatters";

interface Props {
  year: number;
}

export function InterestTable({ year }: Props) {
  const [interest, setInterest] = useState<TaxInterest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await taxesApi.interest(year);
        setInterest(data.interest);
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [year]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Loading interest...</p>
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
    <Card>
      <CardHeader>
        <CardTitle>Interest Payments (§8 - Kapitálový majetek)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Amount (CZK)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {interest.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.date}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">
                    {formatUsd(item.amountUsd)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-green-600">
                    {formatCzk(item.amountCzk)}
                  </TableCell>
                </TableRow>
              ))}
              {interest.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    No interest payments found for {year}
                  </TableCell>
                </TableRow>
              )}
              {interest.length > 0 && (
                <TableRow className="font-semibold bg-muted/50">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right text-green-600">
                    {formatCzk(total)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
