import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check } from "lucide-react";
import { taxesApi } from "@/api/taxes";
import type { LotTraceResponse, LotTraceEntry, ConsumedLot } from "@assup/shared";
import { cn } from "@/lib/utils";

interface LotTraceModalProps {
  symbol: string | null;
  onClose: () => void;
}

export function LotTraceModal({ symbol, onClose }: LotTraceModalProps) {
  const [data, setData] = useState<LotTraceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setData(null);
      return;
    }

    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await taxesApi.lotTrace(symbol);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [symbol]);

  const handleLotClick = (lotRef: string) => {
    const element = document.getElementById(lotRef);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("bg-blue-100");
      setTimeout(() => element.classList.remove("bg-blue-100"), 1500);
    }
  };

  const formatCurrency = (value: number, currency = "USD") => {
    if (currency === "CZK") {
      return new Intl.NumberFormat("cs-CZ", {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return new Intl.NumberFormat("en-US", {
      style: "decimal",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatHoldingPeriod = (days: number) => {
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;
    if (years > 0) {
      return `${years}y ${remainingDays}d`;
    }
    return `${days}d`;
  };

  return (
    <Dialog open={!!symbol} onOpenChange={() => onClose()}>
      <DialogContent className="w-[90vw] !max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{symbol} Lot History</DialogTitle>
          <DialogDescription>
            FIFO lot trace showing how buy lots are consumed by sell trades
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full text-destructive">
              Failed to load lot trace: {error}
            </div>
          )}

          {data && !isLoading && (
            <div className="space-y-4 pr-2">
              {data.entries.map((entry: LotTraceEntry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onLotClick={handleLotClick}
                  formatCurrency={formatCurrency}
                  formatHoldingPeriod={formatHoldingPeriod}
                />
              ))}

              <div className="border-t pt-4 mt-6">
                <span className="text-muted-foreground">Current position: </span>
                <span className="font-medium">{data.currentPosition} shares</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EntryRowProps {
  entry: LotTraceEntry;
  onLotClick: (lotRef: string) => void;
  formatCurrency: (value: number, currency?: string) => string;
  formatHoldingPeriod: (days: number) => string;
}

function EntryRow({
  entry,
  onLotClick,
  formatCurrency,
  formatHoldingPeriod,
}: EntryRowProps) {
  if (entry.type === "buy") {
    return (
      <div
        id={entry.lotRef}
        className="border-l-4 border-blue-400 pl-4 py-2 transition-colors duration-500"
      >
        <div className="flex items-baseline gap-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700">
            BUY
          </Badge>
          <span className="text-muted-foreground">{entry.tradeDate}</span>
          <span className="font-medium">
            {entry.quantity} @ ${formatCurrency(entry.pricePerShare)}
          </span>
          <span className="text-muted-foreground">
            Rate: {formatCurrency(entry.exchangeRate)}
          </span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground ml-1">
          <button
            onClick={() => onLotClick(entry.lotRef)}
            className="text-blue-600 hover:underline font-mono"
          >
            #{entry.lotRef}
          </button>
          <span className="ml-4">
            Cost: ${formatCurrency(entry.costBasisUsd ?? 0)} /{" "}
            {formatCurrency(entry.costBasisCzk ?? 0)} CZK
          </span>
          {entry.remainingQty !== undefined && entry.remainingQty > 0 && (
            <span className="ml-4 text-amber-600">
              ({entry.remainingQty} remaining)
            </span>
          )}
          {entry.remainingQty === 0 && (
            <span className="ml-4 text-green-600">(fully consumed)</span>
          )}
        </div>
      </div>
    );
  }

  // SELL entry
  return (
    <div className="border-l-4 border-gray-300 pl-4 py-2">
      <div className="flex items-baseline gap-2">
        <Badge variant="outline" className="bg-gray-50 text-gray-700">
          SELL
        </Badge>
        <span className="text-muted-foreground">{entry.tradeDate}</span>
        <span className="font-medium">
          {entry.quantity} @ ${formatCurrency(entry.pricePerShare)}
        </span>
        <span className="text-muted-foreground">
          Rate: {formatCurrency(entry.exchangeRate)}
        </span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground ml-1">
        Proceeds: ${formatCurrency(entry.proceedsUsd ?? 0)} /{" "}
        {formatCurrency(entry.proceedsCzk ?? 0)} CZK
      </div>

      {/* Consumed lots */}
      {entry.consumedLots && entry.consumedLots.length > 0 && (
        <div className="mt-2 ml-4 space-y-2">
          {entry.consumedLots.map((lot: ConsumedLot, idx: number) => (
            <ConsumedLotRow
              key={`${lot.lotRef}-${idx}`}
              lot={lot}
              onLotClick={onLotClick}
              formatCurrency={formatCurrency}
              formatHoldingPeriod={formatHoldingPeriod}
              isLast={idx === entry.consumedLots!.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConsumedLotRowProps {
  lot: ConsumedLot;
  onLotClick: (lotRef: string) => void;
  formatCurrency: (value: number, currency?: string) => string;
  formatHoldingPeriod: (days: number) => string;
  isLast: boolean;
}

function ConsumedLotRow({
  lot,
  onLotClick,
  formatCurrency,
  formatHoldingPeriod,
  isLast,
}: ConsumedLotRowProps) {
  return (
    <div className="text-sm border-l-2 border-gray-200 pl-3 py-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{isLast ? "└─" : "├─"}</span>
        <span>{lot.quantity} from</span>
        <button
          onClick={() => onLotClick(lot.lotRef)}
          className="text-blue-600 hover:underline font-mono"
        >
          #{lot.lotRef}
        </button>
      </div>
      <div className="ml-6 text-muted-foreground">
        <div>
          Cost: ${formatCurrency(lot.costBasisUsd)} /{" "}
          {formatCurrency(lot.costBasisCzk)} CZK
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(lot.pnlCzk >= 0 ? "text-green-600" : "text-red-600")}
          >
            P&L: {lot.pnlCzk >= 0 ? "+" : ""}${formatCurrency(lot.pnlUsd)} /{" "}
            {lot.pnlCzk >= 0 ? "+" : ""}
            {formatCurrency(lot.pnlCzk)} CZK
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Held: {formatHoldingPeriod(lot.holdingDays)}</span>
          {lot.isExempt && (
            <Badge
              variant="outline"
              className="bg-green-50 text-green-700 text-xs"
            >
              <Check className="h-3 w-3 mr-1" />
              exempt
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
