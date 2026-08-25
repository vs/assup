/**
 * Roll Out Dialog: closes a breached call/put credit spread and opens a new one
 * at higher (calls) or lower (puts) strikes at a later expiration.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDownUp } from "lucide-react";
import type { ActiveSpread } from "@assup/shared";
import { spreadModeLabel } from "./utils";
import { api } from "@/api";
import { defaultTargetExpiration, expirationsBeyond, calendarDaysBetween, formatExpiry, fmtCurrency } from "./rollOutHelpers";

interface RollOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  onSuccess: () => void;
}

function strikeSummary(spread: ActiveSpread): string {
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  return strikes.join(" / ");
}

export function RollOutDialog({ open, onOpenChange, spread, onSuccess: _onSuccess }: RollOutDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [allExpirations, setAllExpirations] = useState<string[]>([]);
  const [targetExpiration, setTargetExpiration] = useState<string | null>(null);
  const [expirationsLoading, setExpirationsLoading] = useState(false);

  // Reset state on open / spread change
  useEffect(() => {
    if (open && spread) {
      setError(null);
      setTargetExpiration(null);
      setAllExpirations([]);
    }
  }, [open, spread?.id]);

  // Fetch expirations when dialog opens
  useEffect(() => {
    if (!open || !spread) return;
    let cancelled = false;
    setExpirationsLoading(true);
    api.ironCondor.getExpirations(spread.symbol)
      .then(r => {
        if (cancelled) return;
        setAllExpirations(r.expirations);
        setTargetExpiration(defaultTargetExpiration(spread.expiry, r.expirations));
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load expirations");
      })
      .finally(() => {
        if (!cancelled) setExpirationsLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, spread?.id, spread?.symbol]);

  if (!spread) return null;

  const isPut = spread.type === "put-spread";
  const directionLabel = isPut ? "Roll Down & Out" : "Roll Up & Out";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownUp className="h-4 w-4" />
            {directionLabel} — {spread.symbol} {isPut ? "Put" : "Call"} Spread
          </DialogTitle>
          <DialogDescription>
            Close the current spread and open a new one at a {isPut ? "lower" : "higher"} strike, later expiration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current spread context */}
          <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={isPut ? "danger" : "success"}>{spreadModeLabel(spread.type)}</Badge>
              <span className="font-semibold text-sm">{spread.symbol}</span>
              <span className="font-mono text-sm">{strikeSummary(spread)}</span>
              <span className="text-sm text-muted-foreground">{formatExpiry(spread.expiry)}</span>
              <span className="text-sm text-muted-foreground">&times;{spread.quantity}</span>
            </div>
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Close cost (mid)</span>
                <span className="ml-2 font-mono">{fmtCurrency(spread.closeMidPrice)}/ct</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">P&amp;L</span>
                <span className={`ml-2 font-semibold ${spread.totalPnl != null && spread.totalPnl < 0 ? "text-red-600" : "text-green-600"}`}>
                  {fmtCurrency(spread.totalPnl, { sign: true })}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Net premium</span>
                <span className={`ml-2 font-medium ${spread.netPremium >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {fmtCurrency(spread.netPremium, { sign: true })}
                </span>
              </div>
            </div>
          </div>

          {/* Target expiration picker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Target Expiration
              </span>
              {expirationsLoading && (
                <span className="text-xs text-muted-foreground">Loading...</span>
              )}
            </div>
            {(() => {
              const candidates = expirationsBeyond(spread.expiry, allExpirations);
              if (candidates.length === 0 && !expirationsLoading) {
                return (
                  <div className="text-sm text-muted-foreground py-2">
                    No further expirations available for {spread.symbol}.
                  </div>
                );
              }
              return (
                <div className="flex gap-1.5 flex-wrap">
                  {candidates.map(exp => {
                    const dte = calendarDaysBetween(spread.expiry, exp);
                    const month = exp.slice(4, 6);
                    const day = exp.slice(6, 8);
                    const selected = targetExpiration === exp;
                    return (
                      <button
                        key={exp}
                        onClick={() => setTargetExpiration(exp)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-border"
                        }`}
                      >
                        {`${month}/${day}`}
                        <span className="ml-1 text-[10px] opacity-70">+{dte}d</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled>Place Roll Orders</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
