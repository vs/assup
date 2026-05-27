import type {
  WheelStrategyScan,
  WheelStrategyExecuteInput,
  CspResultItem,
  CcResultItem,
} from "@assup/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function CspTable({
  items,
  onExecute,
  executing,
}: {
  items: CspResultItem[];
  onExecute: (input: WheelStrategyExecuteInput) => void;
  executing?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          CSP Candidates
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({items.length} result{items.length !== 1 ? "s" : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Mkt Cap</TableHead>
              <TableHead className="text-right">Alloc Need</TableHead>
              <TableHead>Earnings</TableHead>
              <TableHead className="text-right">Strike</TableHead>
              <TableHead>Expiration</TableHead>
              <TableHead className="text-right">Delta</TableHead>
              <TableHead className="text-right">Bid / Ask</TableHead>
              <TableHead className="text-right">Prem %</TableHead>
              <TableHead className="text-right">Ann. Return</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <CspRow
                key={`${item.symbol}-${item.contract.strike}-${item.contract.expiration}`}
                item={item}
                onExecute={onExecute}
                executing={executing}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CspRow({
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
    <TableRow>
      {/* Symbol + badges */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{item.symbol}</span>
          <Badge variant="outline">{item.assetClassName}</Badge>
          <Badge variant={recommendationVariant(item.researchRecommendation)} className="capitalize">
            {item.researchRecommendation}
          </Badge>
        </div>
      </TableCell>

      {/* Score */}
      <TableCell className="text-right">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-bold tabular-nums ${scoreBadgeClass(item.compositeScore)}`}
        >
          {Math.round(item.compositeScore)}
        </span>
      </TableCell>

      {/* Price */}
      <TableCell className="text-right font-mono">
        ${item.lastPrice.toFixed(2)}
      </TableCell>

      {/* Market Cap */}
      <TableCell className="text-right font-mono">
        {formatMarketCap(item.marketCap)}
      </TableCell>

      {/* Allocation Need */}
      <TableCell className="text-right font-mono">
        {item.allocationNeed.toFixed(1)}%
      </TableCell>

      {/* Earnings */}
      <TableCell>
        {item.earningsDate ? (
          <span>
            <span className="text-green-600 font-medium">Safe</span>
            {" · "}
            {formatDate(item.earningsDate)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Strike */}
      <TableCell className="text-right font-mono">
        ${contract.strike.toFixed(0)}
      </TableCell>

      {/* Expiration + DTE */}
      <TableCell>
        {formatDate(contract.expiration)}
        <span className="text-muted-foreground ml-1">({contract.daysToExpiry}d)</span>
      </TableCell>

      {/* Delta */}
      <TableCell className="text-right font-mono">
        {contract.delta != null ? contract.delta.toFixed(2) : "—"}
      </TableCell>

      {/* Bid / Ask */}
      <TableCell className="text-right font-mono">
        ${contract.bid.toFixed(2)} / ${contract.ask.toFixed(2)}
      </TableCell>

      {/* Premium % */}
      <TableCell className="text-right font-mono">
        {contract.premiumPercent.toFixed(2)}%
      </TableCell>

      {/* Annualized Return */}
      <TableCell className="text-right font-mono font-semibold">
        {contract.annualizedReturn.toFixed(1)}%
      </TableCell>

      {/* Action */}
      <TableCell>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSellPut}
          disabled={executing}
        >
          {executing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Sell Put"
          )}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CcTable({
  items,
  onExecute,
  executing,
}: {
  items: CcResultItem[];
  onExecute: (input: WheelStrategyExecuteInput) => void;
  executing?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          Covered Call Suggestions
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({items.length} result{items.length !== 1 ? "s" : ""})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Cost Basis</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Strike</TableHead>
              <TableHead>Expiration</TableHead>
              <TableHead className="text-right">Bid / Ask</TableHead>
              <TableHead className="text-right">Prem %</TableHead>
              <TableHead className="text-right">Ann. Return</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <CcRow
                key={`${item.symbol}-${item.contract.strike}-${item.contract.expiration}`}
                item={item}
                onExecute={onExecute}
                executing={executing}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CcRow({
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
    <TableRow>
      {/* Symbol + badges */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{item.symbol}</span>
          <Badge variant="secondary">Assigned</Badge>
          <Badge variant="outline">{item.assetClassName}</Badge>
        </div>
      </TableCell>

      {/* Current Price */}
      <TableCell className="text-right font-mono">
        ${item.currentPrice.toFixed(2)}
      </TableCell>

      {/* Cost Basis */}
      <TableCell className="text-right font-mono">
        ${item.costBasis.toFixed(2)}
      </TableCell>

      {/* P&L */}
      <TableCell className="text-right font-mono">
        <span className={isProfitable ? "text-green-600" : "text-red-600"}>
          {isProfitable ? "+" : ""}{pnl.toFixed(2)} ({isProfitable ? "+" : ""}{pnlPct.toFixed(1)}%)
        </span>
      </TableCell>

      {/* Shares */}
      <TableCell className="text-right font-mono">
        {item.sharesHeld.toLocaleString()}
      </TableCell>

      {/* Strike */}
      <TableCell className="text-right font-mono">
        ${contract.strike.toFixed(0)}
      </TableCell>

      {/* Expiration + DTE */}
      <TableCell>
        {formatDate(contract.expiration)}
        <span className="text-muted-foreground ml-1">({contract.daysToExpiry}d)</span>
      </TableCell>

      {/* Bid / Ask */}
      <TableCell className="text-right font-mono">
        ${contract.bid.toFixed(2)} / ${contract.ask.toFixed(2)}
      </TableCell>

      {/* Premium % */}
      <TableCell className="text-right font-mono">
        {contract.premiumPercent.toFixed(2)}%
      </TableCell>

      {/* Annualized Return */}
      <TableCell className="text-right font-mono font-semibold">
        {contract.annualizedReturn.toFixed(1)}%
      </TableCell>

      {/* Action */}
      <TableCell>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSellCall}
          disabled={executing}
        >
          {executing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Sell Call"
          )}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function ScanResults({ scan, onExecute, executing }: ScanResultsProps) {
  if (!scan) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
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
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        {scan.status === "completed"
          ? "No candidates found for this scan."
          : scan.status === "running" || scan.status === "pending"
          ? "Scan is still in progress..."
          : "Scan did not produce results."}
      </div>
    );
  }

  const sortedCsp = [...cspResults].sort((a, b) => b.compositeScore - a.compositeScore);

  return (
    <div className="space-y-6">
      {hasCsp && (
        <CspTable items={sortedCsp} onExecute={onExecute} executing={executing} />
      )}
      {hasCc && (
        <CcTable items={ccResults} onExecute={onExecute} executing={executing} />
      )}
    </div>
  );
}
