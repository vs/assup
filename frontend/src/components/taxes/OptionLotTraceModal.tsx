import { useState, useEffect } from "react";
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
import { cn } from "@/lib/utils";

interface OptionLotTraceModalProps {
  symbol: string | null;
  onClose: () => void;
}

export function OptionLotTraceModal({ symbol, onClose }: OptionLotTraceModalProps) {
  const [data, setData] = useState<OptionLotTraceResponse | null>(null);
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
        const result = await taxesApi.optionLotTrace(symbol);
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
    const element = document.getElementById(`option-${lotRef}`);
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
              Failed to load lot trace: {error}
            </div>
          )}

          {data && !isLoading && (
            <div className="space-y-4 pr-2">
              {data.entries.map((entry: OptionLotTraceEntry) => (
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
                <span className="font-medium">{data.currentPosition} contracts</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EntryRowProps {
  entry: OptionLotTraceEntry;
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
            Premium: ${formatCurrency(Math.abs(entry.totalPremium))} /{" "}
            {formatCurrency(Math.abs(entry.totalPremiumCzk))} CZK
            {isShort ? " (received)" : " (paid)"}
          </span>
          {entry.remainingQty !== undefined && entry.remainingQty > 0 && (
            <span className="ml-4 text-amber-600">
              ({entry.remainingQty} remaining)
            </span>
          )}
          {entry.remainingQty === 0 && (
            <span className="ml-4 text-green-600">(fully closed)</span>
          )}
        </div>
      </div>
    );
  }

  // CLOSE entry
  const getCloseTypeBadge = () => {
    switch (entry.closeType) {
      case "assigned":
        return <Badge variant="secondary" className="bg-purple-50 text-purple-700">Assigned</Badge>;
      case "expired":
        return <Badge variant="outline">Expired</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="border-l-4 border-gray-300 pl-4 py-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <Badge variant="outline" className="bg-gray-50 text-gray-700">
          {entry.action}
        </Badge>
        {getCloseTypeBadge()}
        <span className="text-muted-foreground">{entry.tradeDate}</span>
        <span className="font-medium">
          {entry.quantity} contracts @ ${formatCurrency(Math.abs(entry.premiumPerContract))}
        </span>
        <span className="text-muted-foreground">
          Rate: {formatCurrency(entry.exchangeRate)}
        </span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground ml-1">
        Premium: ${formatCurrency(Math.abs(entry.totalPremium))} /{" "}
        {formatCurrency(Math.abs(entry.totalPremiumCzk))} CZK
      </div>

      {/* Consumed lots */}
      {entry.consumedLots && entry.consumedLots.length > 0 && (
        <div className="mt-2 ml-4 space-y-2">
          {entry.consumedLots.map((lot: OptionConsumedLot, idx: number) => (
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
  lot: OptionConsumedLot;
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
          Open premium: ${formatCurrency(lot.openPremiumUsd)} /{" "}
          {formatCurrency(lot.openPremiumCzk)} CZK
        </div>
        <div>
          Close premium: ${formatCurrency(lot.closePremiumUsd)} /{" "}
          {formatCurrency(lot.closePremiumCzk)} CZK
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(lot.pnlCzk >= 0 ? "text-green-600" : "text-red-600")}
          >
            P&L: {lot.pnlUsd >= 0 ? "+" : ""}${formatCurrency(lot.pnlUsd)} /{" "}
            {lot.pnlCzk >= 0 ? "+" : ""}
            {formatCurrency(lot.pnlCzk)} CZK
          </span>
        </div>
        <div>
          <span>Held: {formatHoldingPeriod(lot.holdingDays)}</span>
        </div>
      </div>
    </div>
  );
}
