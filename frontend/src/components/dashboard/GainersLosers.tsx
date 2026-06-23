import { useState } from "react";
import { formatCurrency } from "@assup/shared";
import type { Position } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Mode = "gainers" | "losers";

interface GainersLosersProps {
  positions: Position[] | undefined;
}

export function GainersLosers({ positions }: GainersLosersProps) {
  const [mode, setMode] = useState<Mode>("gainers");

  const stkPositions = (positions ?? []).filter(
    (p) => p.secType === "STK" && p.unrealizedPnl !== null
  );

  const sorted =
    mode === "gainers"
      ? stkPositions
          .filter((p) => (p.unrealizedPnl ?? 0) > 0)
          .sort((a, b) => (b.unrealizedPnl ?? 0) - (a.unrealizedPnl ?? 0))
          .slice(0, 5)
      : stkPositions
          .filter((p) => (p.unrealizedPnl ?? 0) < 0)
          .sort((a, b) => (a.unrealizedPnl ?? 0) - (b.unrealizedPnl ?? 0))
          .slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Gainers &amp; Losers</CardTitle>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
          >
            <ToggleGroupItem value="gainers" className="text-xs px-3 h-7">
              Gainers
            </ToggleGroupItem>
            <ToggleGroupItem value="losers" className="text-xs px-3 h-7">
              Losers
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {sorted.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No positions</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left font-medium pb-1">Symbol</th>
                <th className="text-right font-medium pb-1">Qty</th>
                <th className="text-right font-medium pb-1">Price</th>
                <th className="text-right font-medium pb-1">P&amp;L</th>
                <th className="text-right font-medium pb-1">Return</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const price =
                  p.marketValue !== null && p.position !== 0
                    ? p.marketValue / p.position
                    : null;
                const returnPct =
                  p.unrealizedPnl !== null && p.avgCost !== 0 && p.position !== 0
                    ? (p.unrealizedPnl / (p.avgCost * Math.abs(p.position))) * 100
                    : null;
                const pnlColor =
                  (p.unrealizedPnl ?? 0) >= 0 ? "text-green-600" : "text-red-600";

                return (
                  <tr key={p.symbol + p.conId} className="border-b last:border-0">
                    <td className="py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{p.symbol}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          STK
                        </Badge>
                      </div>
                    </td>
                    <td className="text-right tabular-nums py-1.5">{p.position}</td>
                    <td className="text-right tabular-nums py-1.5">
                      {price !== null ? formatCurrency(price) : "—"}
                    </td>
                    <td className={`text-right tabular-nums font-semibold py-1.5 ${pnlColor}`}>
                      {p.unrealizedPnl !== null ? formatCurrency(p.unrealizedPnl) : "—"}
                    </td>
                    <td className={`text-right tabular-nums py-1.5 ${pnlColor}`}>
                      {returnPct !== null ? `${returnPct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
