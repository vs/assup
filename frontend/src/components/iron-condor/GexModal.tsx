import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGexAnalysis } from "@/hooks/useGexAnalysis";
import { useGexProfile } from "@/hooks/useGexProfile";
import { GexMetrics } from "./GexMetrics";
import { GexProfileChart } from "./GexProfileChart";
import { OIChart } from "./OIChart";
import { GexSpreadRecommendation } from "./GexSpreadRecommendation";
/** Dealer gamma across all expirations, independent of the Single/Aggregate toggle. */
function GexProfilePanel({ symbol }: { symbol: string | null }) {
  const { data, isLoading, error, refresh, refreshing } = useGexProfile(symbol);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Fetching all expirations...</span>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
        Failed to fetch dealer gamma profile: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="relative">
      <button
        onClick={() => void refresh()}
        disabled={refreshing}
        title="Refetch all expirations"
        className="absolute right-3 top-3 z-10 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </button>
      <GexProfileChart data={data} />
    </div>
  );
}
import { Loader2, RefreshCw } from "lucide-react";
import type { IronCondorChainStrike, SpreadMode, SpreadSelectedLegs } from "@assup/shared";

interface GexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  expiration?: string;
  /** Spread builder context for recommendations */
  chain: IronCondorChainStrike[];
  mode: SpreadMode;
  putDelta: number;
  callDelta: number;
  wingWidth: number;
  onApplyLegs: (legs: SpreadSelectedLegs) => void;
}

export function GexModal({
  open,
  onOpenChange,
  symbol,
  expiration,
  chain,
  mode,
  putDelta,
  callDelta,
  wingWidth,
  onApplyLegs,
}: GexModalProps) {
  const [aggregate, setAggregate] = useState(false);

  // IronCondorPage stores expirations as YYYYMMDD, but the GEX API expects YYYY-MM-DD
  const isoExpiration = expiration && expiration.length === 8
    ? `${expiration.slice(0, 4)}-${expiration.slice(4, 6)}-${expiration.slice(6, 8)}`
    : expiration;

  const { data, isLoading, error } = useGexAnalysis(
    open ? symbol : null,
    { expiration: aggregate ? undefined : isoExpiration, aggregate },
  );

  const handleApply = (legs: SpreadSelectedLegs) => {
    onApplyLegs(legs);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[calc(100vw-3rem)] w-[1600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>GEX Analysis: {symbol}</DialogTitle>
            <div className="flex rounded-md border overflow-hidden mr-8">
              <button
                onClick={() => setAggregate(false)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  !aggregate ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                Single
              </button>
              <button
                onClick={() => setAggregate(true)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  aggregate ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                }`}
              >
                Aggregate
              </button>
            </div>
          </div>
        </DialogHeader>

        <GexProfilePanel symbol={open ? symbol : null} />

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Fetching options chain data...</span>
          </div>
        )}

        {error && !data && (
          <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">
            Failed to fetch GEX data: {error instanceof Error ? error.message : "Unknown error"}
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {data.stale && (
              <div className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 px-4 py-2 rounded-lg text-xs">
                Showing cached data from {new Date(data.fetchedAt).toLocaleTimeString()} — live fetch failed
              </div>
            )}

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>Spot: <span className="font-semibold text-foreground">{data.spot.toLocaleString()}</span></span>
              {data.analyzedExpiration && <span>Expiry: {data.analyzedExpiration}</span>}
              {data.isAggregate && <span>Aggregate ({data.expirations.filter(e => {
                const d = new Date(e);
                const now = new Date();
                now.setHours(0,0,0,0);
                const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                return d >= now && d <= maxDate;
              }).length} expirations)</span>}
              <span>Fetched: {new Date(data.fetchedAt).toLocaleTimeString()}</span>
            </div>

            <GexMetrics levels={data.levels} summary={data.summary} spot={data.spot} />
            <OIChart
              strikes={data.strikes}
              spot={data.spot}
              levels={data.levels}
              scope={data.isAggregate ? "all expirations within 7 DTE" : `expiry ${data.analyzedExpiration}`}
            />

            <GexSpreadRecommendation
              gexData={data}
              chain={chain}
              mode={mode}
              putDelta={putDelta}
              callDelta={callDelta}
              wingWidth={wingWidth}
              onApply={handleApply}
            />

            <div className="flex items-center gap-6 text-xs text-muted-foreground border-t pt-3">
              <span>P/C Ratio: <span className="font-semibold text-foreground">{data.summary.putCallRatio.toFixed(2)}</span></span>
              <span>Total Put OI: <span className="font-semibold text-foreground">{data.summary.totalPutOI.toLocaleString()}</span></span>
              <span>Total Call OI: <span className="font-semibold text-foreground">{data.summary.totalCallOI.toLocaleString()}</span></span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
