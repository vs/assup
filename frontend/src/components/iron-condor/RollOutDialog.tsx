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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDownUp } from "lucide-react";
import type { ActiveSpread } from "@assup/shared";
import { spreadModeLabel } from "./utils";

interface RollOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  onSuccess: () => void;
}

function formatExpiry(expiry: string): string {
  if (expiry.length !== 8) return expiry;
  const d = new Date(parseInt(expiry.slice(0, 4)), parseInt(expiry.slice(4, 6)) - 1, parseInt(expiry.slice(6, 8)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
}

function strikeSummary(spread: ActiveSpread): string {
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  return strikes.join(" / ");
}

function fmtCurrency(value: number | null, opts?: { sign?: boolean }): string {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (opts?.sign) return value >= 0 ? `+${formatted}` : `-${formatted}`;
  return value < 0 ? `-${formatted}` : formatted;
}

export function RollOutDialog({ open, onOpenChange, spread, onSuccess: _onSuccess }: RollOutDialogProps) {
  const [error, setError] = useState<string | null>(null);

  // Reset error state on open/spread change
  useEffect(() => {
    if (open) setError(null);
  }, [open, spread?.id]);

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

          {/* Inputs and live data go here in subsequent tasks */}

          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
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
