import { useNavigate, Link } from "react-router-dom";
import { formatCurrency } from "@assup/shared";
import type { WheelTickerSummary } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";

type WheelPhase = WheelTickerSummary["currentPhase"];

function PhaseBadge({ phase }: { phase: WheelPhase }) {
  const config: Record<WheelPhase, { label: string; className: string }> = {
    csp_open: { label: "CSP", className: "bg-yellow-100 text-yellow-800" },
    holding_shares: { label: "Shares", className: "bg-blue-100 text-blue-800" },
    cc_open: { label: "CC", className: "bg-purple-100 text-purple-800" },
    idle: { label: "Idle", className: "bg-gray-100 text-gray-800" },
  };
  const { label, className } = config[phase] ?? config.idle;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  );
}

interface ActiveWheelsListProps {
  tickers: WheelTickerSummary[] | undefined;
}

export function ActiveWheelsList({ tickers }: ActiveWheelsListProps) {
  const navigate = useNavigate();

  const sorted = [...(tickers ?? [])].sort((a, b) => b.realizedPnL - a.realizedPnL).slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Active Wheels</CardTitle>
            {tickers && tickers.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {tickers.filter((t) => t.currentPhase !== "idle").length} active · Capital {formatCurrency(tickers.reduce((s, t) => s + (t.capitalDeployed ?? 0), 0))}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => navigate("/wheel")}
          >
            View all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {sorted.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No tracked wheels</div>
        ) : (
          sorted.map((ticker) => {
            const pnlColor = ticker.totalPnL >= 0 ? "text-green-600" : "text-red-600";
            return (
              <div key={ticker.symbol} className="rounded-md border px-3 py-2 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TickerHoverCard symbol={ticker.symbol}>
                      <Link to={`/tickers/${ticker.symbol}`} className="font-semibold text-sm hover:underline">
                        {ticker.symbol}
                      </Link>
                    </TickerHoverCard>
                    <PhaseBadge phase={ticker.currentPhase} />
                  </div>
                  <span className={`font-semibold tabular-nums text-sm ${pnlColor}`}>
                    {formatCurrency(ticker.totalPnL)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    Realized{" "}
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(ticker.realizedPnL)}
                    </span>
                  </span>
                  <span>
                    Unreal.{" "}
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(ticker.unrealizedPnL)}
                    </span>
                  </span>
                  <span>
                    Cycles{" "}
                    <span className="tabular-nums text-foreground">{ticker.completedCycles}</span>
                  </span>
                  {ticker.totalPnLPercent !== null && (
                    <span>
                      ROC{" "}
                      <span className={`tabular-nums font-medium ${pnlColor}`}>
                        {ticker.totalPnLPercent.toFixed(1)}%
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
