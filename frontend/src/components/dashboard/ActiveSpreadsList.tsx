import { useNavigate, Link } from "react-router-dom";
import { formatCurrency } from "@assup/shared";
import type { ActiveSpread, SpreadMode, ActiveSpreadLeg } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";

function SpreadTypeBadge({ type }: { type: SpreadMode }) {
  const config: Record<SpreadMode, { label: string; variant: "danger" | "success" | "purple" }> = {
    "iron-condor": { label: "Iron Condor", variant: "purple" },
    "put-spread": { label: "Put Spread", variant: "danger" },
    "call-spread": { label: "Call Spread", variant: "success" },
  };
  const { label, variant } = config[type];
  return <Badge variant={variant}>{label}</Badge>;
}

function formatExpiry(expiry: string): string {
  // expiry format: "20260417" → "Apr 17"
  if (expiry.length === 8) {
    const year = expiry.slice(0, 4);
    const month = parseInt(expiry.slice(4, 6), 10) - 1;
    const day = parseInt(expiry.slice(6, 8), 10);
    const date = new Date(parseInt(year, 10), month, day);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return expiry;
}

function buildLegsDescription(legs: ActiveSpreadLeg[], type: SpreadMode, quantity: number): string {
  const sorted = [...legs].sort((a, b) => a.strike - b.strike);

  if (type === "iron-condor") {
    const puts = sorted.filter((l) => l.right === "P");
    const calls = sorted.filter((l) => l.right === "C");
    const putSell = puts.find((l) => l.side === "SELL");
    const putBuy = puts.find((l) => l.side === "BUY");
    const callSell = calls.find((l) => l.side === "SELL");
    const callBuy = calls.find((l) => l.side === "BUY");

    const parts: string[] = [];
    if (putSell) parts.push(`${putSell.strike}P`);
    if (putBuy) parts.push(`${putBuy.strike}P`);
    if (callSell) parts.push(`${callSell.strike}C`);
    if (callBuy) parts.push(`${callBuy.strike}C`);

    return parts.join(" / ") + (quantity > 1 ? ` ×${quantity}` : "");
  }

  if (type === "put-spread") {
    const putSell = sorted.find((l) => l.right === "P" && l.side === "SELL");
    const putBuy = sorted.find((l) => l.right === "P" && l.side === "BUY");
    const parts: string[] = [];
    if (putSell) parts.push(`${putSell.strike}P`);
    if (putBuy) parts.push(`${putBuy.strike}P`);
    return parts.join(" / ") + (quantity > 1 ? ` ×${quantity}` : "");
  }

  if (type === "call-spread") {
    const callSell = sorted.find((l) => l.right === "C" && l.side === "SELL");
    const callBuy = sorted.find((l) => l.right === "C" && l.side === "BUY");
    const parts: string[] = [];
    if (callSell) parts.push(`${callSell.strike}C`);
    if (callBuy) parts.push(`${callBuy.strike}C`);
    return parts.join(" / ") + (quantity > 1 ? ` ×${quantity}` : "");
  }

  return legs.map((l) => `${l.strike}${l.right}`).join(" / ");
}

function calcDte(expiry: string): number {
  // expiry format: "20260417"
  let expiryDate: Date;
  if (expiry.length === 8) {
    const year = parseInt(expiry.slice(0, 4), 10);
    const month = parseInt(expiry.slice(4, 6), 10) - 1;
    const day = parseInt(expiry.slice(6, 8), 10);
    expiryDate = new Date(year, month, day);
  } else {
    expiryDate = new Date(expiry);
  }
  return Math.ceil((expiryDate.getTime() - Date.now()) / 86400000);
}

interface ActiveSpreadsListProps {
  spreads: ActiveSpread[] | undefined;
}

export function ActiveSpreadsList({ spreads }: ActiveSpreadsListProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Active Spreads</CardTitle>
            {spreads && spreads.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {spreads.length} · P&L <span className={(spreads.reduce((s, sp) => s + (sp.totalPnl ?? 0), 0)) >= 0 ? "text-green-600" : "text-red-600"}>
                  {formatCurrency(spreads.reduce((s, sp) => s + (sp.totalPnl ?? 0), 0))}
                </span>
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => navigate("/spreads")}
          >
            View all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {!spreads || spreads.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No active spreads</div>
        ) : (
          spreads.slice(0, 5).map((spread) => {
            const pnlColor = (spread.totalPnl ?? 0) >= 0 ? "text-green-600" : "text-red-600";
            const dte = calcDte(spread.expiry);
            const legsDesc = buildLegsDescription(spread.legs, spread.type, spread.quantity);

            return (
              <div key={spread.id} className="rounded-md border px-3 py-2 space-y-1">
                <div className="flex items-center gap-2">
                  <TickerHoverCard symbol={spread.symbol}>
                    <Link to={`/tickers/${spread.symbol}`} className="font-semibold text-sm hover:underline">
                      {spread.symbol}
                    </Link>
                  </TickerHoverCard>
                  <SpreadTypeBadge type={spread.type} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {legsDesc}
                  {spread.expiry && (
                    <span className="ml-1">· {formatExpiry(spread.expiry)}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    Premium{" "}
                    <span className="tabular-nums text-foreground font-medium">
                      {formatCurrency(spread.netPremium)}
                    </span>
                  </span>
                  <span>
                    P&amp;L{" "}
                    <span className={`tabular-nums font-semibold ${pnlColor}`}>
                      {spread.totalPnl !== null ? formatCurrency(spread.totalPnl) : "—"}
                    </span>
                  </span>
                  <span>
                    DTE{" "}
                    <span className={`tabular-nums font-medium ${dte <= 7 ? "text-red-600" : "text-foreground"}`}>
                      {dte}
                    </span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
