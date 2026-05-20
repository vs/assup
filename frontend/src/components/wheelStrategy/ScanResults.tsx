import type {
  WheelStrategyScan,
  WheelStrategyExecuteInput,
  CspResultItem,
  CcResultItem,
} from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ScanResultsProps {
  scan: WheelStrategyScan | null;
  onExecute: (input: WheelStrategyExecuteInput) => void;
  executing?: boolean;
}

function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400";
  if (score >= 40) return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400";
  return "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400";
}

function recommendationVariant(rec: string): "success" | "danger" | "secondary" | "outline" {
  if (rec === "buy" || rec === "wheel") return "success";
  if (rec === "sell" || rec === "avoid") return "danger";
  return "secondary";
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CspCard({
  item,
  onExecute,
  executing,
}: {
  item: CspResultItem;
  onExecute: (input: WheelStrategyExecuteInput) => void;
  executing?: boolean;
}) {
  const { contract } = item;

  function handleSellPut() {
    onExecute({
      type: "csp",
      symbol: item.symbol,
      strike: contract.strike,
      expiration: contract.expiration,
      quantity: 1,
      limitPrice: contract.midPrice,
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header: symbol, score */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-lg font-bold">{item.symbol}</span>
            <Badge variant="outline" className="text-xs">{item.assetClassName}</Badge>
            <Badge
              variant={recommendationVariant(item.researchRecommendation)}
              className="text-xs capitalize"
            >
              {item.researchRecommendation}
            </Badge>
          </div>
          <span
            className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-bold tabular-nums ${scoreBadgeClass(item.compositeScore)}`}
          >
            {Math.round(item.compositeScore)}
          </span>
        </div>

        {/* Earnings */}
        <div className="text-xs text-muted-foreground">
          {item.earningsDate ? (
            <>
              <span className="text-green-600 font-medium">Safe</span>
              {" "}· Earnings {formatDate(item.earningsDate)}
            </>
          ) : (
            <span>No upcoming earnings</span>
          )}
        </div>

        {/* Stock info */}
        <div className="space-y-1">
          <MetricRow label="Last Price" value={`$${item.lastPrice.toFixed(2)}`} />
          <MetricRow label="Market Cap" value={formatMarketCap(item.marketCap)} />
          <MetricRow label="Allocation Need" value={`${item.allocationNeed.toFixed(1)}%`} />
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Contract info */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Contract
          </div>
          <MetricRow label="Strike" value={`$${contract.strike.toFixed(0)}`} />
          <MetricRow label="Expiration" value={formatDate(contract.expiration)} />
          <MetricRow label="DTE" value={`${contract.daysToExpiry}d`} />
          {contract.delta != null && (
            <MetricRow label="Delta" value={contract.delta.toFixed(2)} />
          )}
          <MetricRow
            label="Bid / Ask"
            value={`$${contract.bid.toFixed(2)} / $${contract.ask.toFixed(2)}`}
          />
          <MetricRow label="Mid Price" value={`$${contract.midPrice.toFixed(2)}`} />
          <MetricRow label="Premium %" value={`${contract.premiumPercent.toFixed(2)}%`} />
          <MetricRow label="Ann. Return" value={`${contract.annualizedReturn.toFixed(1)}%`} />
        </div>

        {/* Action */}
        <Button
          className="w-full"
          size="sm"
          onClick={handleSellPut}
          disabled={executing}
        >
          {executing ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Placing...
            </>
          ) : (
            "Sell Put"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function CcCard({
  item,
  onExecute,
  executing,
}: {
  item: CcResultItem;
  onExecute: (input: WheelStrategyExecuteInput) => void;
  executing?: boolean;
}) {
  const { contract } = item;
  const pnl = item.currentPrice - item.costBasis;
  const pnlPct = item.costBasis > 0 ? (pnl / item.costBasis) * 100 : 0;
  const isProfitable = pnl >= 0;

  function handleSellCall() {
    onExecute({
      type: "cc",
      symbol: item.symbol,
      strike: contract.strike,
      expiration: contract.expiration,
      quantity: 1,
      limitPrice: contract.midPrice,
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg font-bold">{item.symbol}</span>
          <Badge variant="secondary" className="text-xs">Assigned</Badge>
          <Badge variant="outline" className="text-xs">{item.assetClassName}</Badge>
        </div>

        {/* Stock position info */}
        <div className="space-y-1">
          <MetricRow label="Current Price" value={`$${item.currentPrice.toFixed(2)}`} />
          <MetricRow label="Cost Basis" value={`$${item.costBasis.toFixed(2)}`} />
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">P&amp;L</span>
            <span className={`font-medium tabular-nums ${isProfitable ? "text-green-600" : "text-red-600"}`}>
              {isProfitable ? "+" : ""}{pnl.toFixed(2)} ({isProfitable ? "+" : ""}{pnlPct.toFixed(1)}%)
            </span>
          </div>
          <MetricRow label="Shares Held" value={item.sharesHeld.toLocaleString()} />
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Contract info */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Contract
          </div>
          <MetricRow label="Strike" value={`$${contract.strike.toFixed(0)}`} />
          <MetricRow label="Expiration" value={formatDate(contract.expiration)} />
          <MetricRow label="DTE" value={`${contract.daysToExpiry}d`} />
          <MetricRow
            label="Bid / Ask"
            value={`$${contract.bid.toFixed(2)} / $${contract.ask.toFixed(2)}`}
          />
          <MetricRow label="Mid Price" value={`$${contract.midPrice.toFixed(2)}`} />
          <MetricRow label="Premium %" value={`${contract.premiumPercent.toFixed(2)}%`} />
          <MetricRow label="Ann. Return" value={`${contract.annualizedReturn.toFixed(1)}%`} />
        </div>

        {/* Action */}
        <Button
          className="w-full"
          size="sm"
          onClick={handleSellCall}
          disabled={executing}
        >
          {executing ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Placing...
            </>
          ) : (
            "Sell Call"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export function ScanResults({ scan, onExecute, executing }: ScanResultsProps) {
  if (!scan) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        No scan selected. Run a scan to see results.
      </div>
    );
  }

  const cspResults = scan.cspResults ?? [];
  const ccResults = scan.ccResults ?? [];

  const hasCsp = cspResults.length > 0;
  const hasCc = ccResults.length > 0;

  if (!hasCsp && !hasCc) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        {scan.status === "completed"
          ? "No candidates found for this scan."
          : scan.status === "running" || scan.status === "pending"
          ? "Scan is still in progress..."
          : "Scan did not produce results."}
      </div>
    );
  }

  // CSP results are expected to be pre-sorted by compositeScore descending from backend,
  // but we sort here as a safety measure.
  const sortedCsp = [...cspResults].sort((a, b) => b.compositeScore - a.compositeScore);

  return (
    <div className="space-y-8">
      {hasCsp && (
        <section>
          <h3 className="text-base font-semibold mb-3">
            CSP Candidates
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({cspResults.length} result{cspResults.length !== 1 ? "s" : ""})
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedCsp.map((item) => (
              <CspCard
                key={`${item.symbol}-${item.contract.strike}-${item.contract.expiration}`}
                item={item}
                onExecute={onExecute}
                executing={executing}
              />
            ))}
          </div>
        </section>
      )}

      {hasCc && (
        <section>
          <h3 className="text-base font-semibold mb-3">
            Covered Call Suggestions
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({ccResults.length} result{ccResults.length !== 1 ? "s" : ""})
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {ccResults.map((item) => (
              <CcCard
                key={`${item.symbol}-${item.contract.strike}-${item.contract.expiration}`}
                item={item}
                onExecute={onExecute}
                executing={executing}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
