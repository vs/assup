import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { taxesApi } from "@/api/taxes";
import type { OptionLotTraceResponse, OptionLotTraceEntry, OptionConsumedLot } from "@assup/shared";
import { cn, formatCurrency, formatHoldingPeriod, scrollToAndHighlight } from "@/lib/utils";

interface OptionLotTraceModalProps {
  symbol: string | null;
  onClose: () => void;
}

export function OptionLotTraceModal({ symbol, onClose }: OptionLotTraceModalProps) {
  const [data, setData] = useState<OptionLotTraceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (sym: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await taxesApi.optionLotTrace(sym);
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

  const handleLotClick = (lotRef: string) => scrollToAndHighlight(`option-${lotRef}`);

  return (
    <Dialog open={!!symbol} onOpenChange={() => onClose()}>
      <DialogContent className="w-[90vw] !max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{data?.symbol || symbol} Lot History</DialogTitle>
          <DialogDescription>
            {data?.description || "FIFO lot trace showing how open positions are consumed by closes"}
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
                <EntryRow key={entry.id} entry={entry} onLotClick={handleLotClick} />
              ))}
              <div className="border-t pt-4 mt-6">
                <span className="text-muted-foreground">Current position: </span>
                <span className="font-medium">{data.currentPosition} contracts</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EntryRow({ entry, onLotClick }: { entry: OptionLotTraceEntry; onLotClick: (ref: string) => void }) {
  if (entry.type === "open") {
    const isShort = entry.action === "SELL to open";
    return (
      <div
        id={`option-${entry.lotRef}`}
        className="border-l-4 border-blue-400 pl-4 py-2 transition-colors duration-500"
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <Badge variant="outline" className={cn(
            isShort ? "bg-orange-50 text-orange-700" : "bg-blue-50 text-blue-700"
          )}>
            {entry.action}
          </Badge>
          <span className="text-muted-foreground">{entry.tradeDate}</span>
          <span className="font-medium">
            {entry.quantity} contracts @ ${formatCurrency(Math.abs(entry.premiumPerContract))}
          </span>
          <span className="text-muted-foreground">Rate: {formatCurrency(entry.exchangeRate)}</span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground ml-1">
          <button onClick={() => onLotClick(entry.lotRef)} className="text-blue-600 hover:underline font-mono">
            #{entry.lotRef}
          </button>
          <span className="ml-4">
            Premium: ${formatCurrency(Math.abs(entry.totalPremium))} / {formatCurrency(Math.abs(entry.totalPremiumCzk), "CZK")} CZK
            {isShort ? " (received)" : " (paid)"}
          </span>
          {entry.remainingQty !== undefined && entry.remainingQty > 0 && (
            <span className="ml-4 text-amber-600">({entry.remainingQty} remaining)</span>
          )}
          {entry.remainingQty === 0 && (
            <span className="ml-4 text-green-600">(fully closed)</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-l-4 border-gray-300 pl-4 py-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <Badge variant="outline" className="bg-gray-50 text-gray-700">{entry.action}</Badge>
        {entry.closeType === "assigned" && (
          <Badge variant="secondary" className="bg-purple-50 text-purple-700">Assigned</Badge>
        )}
        {entry.closeType === "expired" && <Badge variant="outline">Expired</Badge>}
        <span className="text-muted-foreground">{entry.tradeDate}</span>
        <span className="font-medium">
          {entry.quantity} contracts @ ${formatCurrency(Math.abs(entry.premiumPerContract))}
        </span>
        <span className="text-muted-foreground">Rate: {formatCurrency(entry.exchangeRate)}</span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground ml-1">
        Premium: ${formatCurrency(Math.abs(entry.totalPremium))} / {formatCurrency(Math.abs(entry.totalPremiumCzk), "CZK")} CZK
      </div>

      {entry.consumedLots && entry.consumedLots.length > 0 && (
        <div className="mt-2 ml-4 space-y-2">
          {entry.consumedLots.map((lot, idx) => (
            <ConsumedLotRow
              key={`${lot.lotRef}-${idx}`}
              lot={lot}
              onLotClick={onLotClick}
              isLast={idx === entry.consumedLots!.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConsumedLotRow({ lot, onLotClick, isLast }: { lot: OptionConsumedLot; onLotClick: (ref: string) => void; isLast: boolean }) {
  return (
    <div className="text-sm border-l-2 border-gray-200 pl-3 py-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{isLast ? "└─" : "├─"}</span>
        <span>{lot.quantity} from</span>
        <button onClick={() => onLotClick(lot.lotRef)} className="text-blue-600 hover:underline font-mono">
          #{lot.lotRef}
        </button>
      </div>
      <div className="ml-6 text-muted-foreground">
        <div>Open: ${formatCurrency(lot.openPremiumUsd)} / {formatCurrency(lot.openPremiumCzk, "CZK")} CZK</div>
        <div>Close: ${formatCurrency(lot.closePremiumUsd)} / {formatCurrency(lot.closePremiumCzk, "CZK")} CZK</div>
        <div>
          <span className={cn(lot.pnlCzk >= 0 ? "text-green-600" : "text-red-600")}>
            P&L: {lot.pnlUsd >= 0 ? "+" : ""}${formatCurrency(lot.pnlUsd)} / {lot.pnlCzk >= 0 ? "+" : ""}{formatCurrency(lot.pnlCzk, "CZK")} CZK
          </span>
        </div>
        <div>Held: {formatHoldingPeriod(lot.holdingDays)}</div>
      </div>
    </div>
  );
}
