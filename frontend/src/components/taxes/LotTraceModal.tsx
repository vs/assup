import { useState, useEffect, useCallback } from "react";
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
import { cn, formatCurrency, formatHoldingPeriod, scrollToAndHighlight } from "@/lib/utils";
import { ArrowRight, Split, RefreshCw } from "lucide-react";

interface LotTraceModalProps {
  symbol: string | null;
  onClose: () => void;
}

export function LotTraceModal({ symbol, onClose }: LotTraceModalProps) {
  const [data, setData] = useState<LotTraceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (sym: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await taxesApi.lotTrace(sym);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (symbol) fetchData(symbol);
  }, [symbol, fetchData]);

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
              Failed to load: {error}
            </div>
          )}

          {data && !isLoading && (
            <div className="space-y-4 pr-2">
              {data.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
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

function EntryRow({ entry }: { entry: LotTraceEntry }) {
  if (entry.type === "buy") {
    return (
      <div
        id={entry.lotRef}
        className="border-l-4 border-blue-400 pl-4 py-2 transition-colors duration-500"
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <Badge variant="outline" className="bg-blue-50 text-blue-700">BUY</Badge>
          <span className="text-muted-foreground">{entry.tradeDate}</span>
          <span className="font-medium">
            {entry.quantity} @ ${formatCurrency(entry.pricePerShare)}
          </span>
          <span className="text-muted-foreground">Rate: {formatCurrency(entry.exchangeRate)}</span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground ml-1">
          <button
            onClick={() => scrollToAndHighlight(entry.lotRef)}
            className="text-blue-600 hover:underline font-mono"
          >
            #{entry.lotRef}
          </button>
          <span className="ml-4">
            Cost: ${formatCurrency(entry.costBasisUsd ?? 0)} / {formatCurrency(entry.costBasisCzk ?? 0, "CZK")} CZK
          </span>
          {entry.remainingQty !== undefined && entry.remainingQty > 0 && (
            <span className="ml-4 text-amber-600">({entry.remainingQty} remaining)</span>
          )}
          {entry.remainingQty === 0 && (
            <span className="ml-4 text-green-600">(fully consumed)</span>
          )}
        </div>
      </div>
    );
  }

  if (entry.type === "corporate_action") {
    const actionLabel = getActionLabel(entry.actionType);
    const isSplit = entry.actionType === "FS" || entry.actionType === "RS" || entry.actionType === "SD";

    return (
      <div className="border-l-4 border-purple-400 pl-4 py-2 bg-purple-50/50">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="bg-purple-100 text-purple-700">
            {isSplit ? <Split className="h-3 w-3 mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            {actionLabel}
          </Badge>
          <span className="text-muted-foreground">{entry.tradeDate}</span>
          {entry.splitRatio && (
            <span className="font-medium text-purple-700">
              {entry.splitRatio}:1 split
            </span>
          )}
        </div>
        {entry.actionDescription && (
          <div className="mt-1 text-sm text-muted-foreground ml-1">
            {entry.actionDescription}
          </div>
        )}
        {entry.affectedLots && entry.affectedLots.length > 0 && (
          <div className="mt-2 ml-4 space-y-1">
            {entry.affectedLots.map((affected, idx) => (
              <div key={affected.lotRef} className="text-sm flex items-center gap-2">
                <span className="text-muted-foreground">{idx === entry.affectedLots!.length - 1 ? "└─" : "├─"}</span>
                <button
                  onClick={() => scrollToAndHighlight(affected.lotRef)}
                  className="text-blue-600 hover:underline font-mono"
                >
                  #{affected.lotRef}
                </button>
                <span className="text-muted-foreground">{affected.quantityBefore}</span>
                <ArrowRight className="h-3 w-3 text-purple-500" />
                <span className="font-medium text-purple-700">{affected.quantityAfter}</span>
                <span className="text-muted-foreground">shares</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-l-4 border-gray-300 pl-4 py-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <Badge variant="outline" className="bg-gray-50 text-gray-700">SELL</Badge>
        <span className="text-muted-foreground">{entry.tradeDate}</span>
        <span className="font-medium">
          {entry.quantity} @ ${formatCurrency(entry.pricePerShare)}
        </span>
        <span className="text-muted-foreground">Rate: {formatCurrency(entry.exchangeRate)}</span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground ml-1">
        Proceeds: ${formatCurrency(entry.proceedsUsd ?? 0)} / {formatCurrency(entry.proceedsCzk ?? 0, "CZK")} CZK
      </div>

      {entry.consumedLots && entry.consumedLots.length > 0 && (
        <div className="mt-2 ml-4 space-y-2">
          {entry.consumedLots.map((lot, idx) => (
            <ConsumedLotRow
              key={`${lot.lotRef}-${idx}`}
              lot={lot}
              isLast={idx === entry.consumedLots!.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function getActionLabel(actionType?: string): string {
  switch (actionType) {
    case "FS": return "SPLIT";
    case "RS": return "REVERSE SPLIT";
    case "SD": return "STOCK DIVIDEND";
    case "TC": return "TICKER CHANGE";
    case "SO": return "SPIN-OFF";
    default: return "CORPORATE ACTION";
  }
}

function ConsumedLotRow({ lot, isLast }: { lot: ConsumedLot; isLast: boolean }) {
  return (
    <div className="text-sm border-l-2 border-gray-200 pl-3 py-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{isLast ? "└─" : "├─"}</span>
        <span>{lot.quantity} from</span>
        <button
          onClick={() => scrollToAndHighlight(lot.lotRef)}
          className="text-blue-600 hover:underline font-mono"
        >
          #{lot.lotRef}
        </button>
      </div>
      <div className="ml-6 text-muted-foreground">
        <div>Cost: ${formatCurrency(lot.costBasisUsd)} / {formatCurrency(lot.costBasisCzk, "CZK")} CZK</div>
        <div>
          <span className={cn(lot.pnlCzk >= 0 ? "text-green-600" : "text-red-600")}>
            P&L: {lot.pnlUsd >= 0 ? "+" : ""}${formatCurrency(lot.pnlUsd)} / {lot.pnlCzk >= 0 ? "+" : ""}{formatCurrency(lot.pnlCzk, "CZK")} CZK
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Held: {formatHoldingPeriod(lot.holdingDays)}</span>
          {lot.isExempt && (
            <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
              <Check className="h-3 w-3 mr-1" />exempt
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
