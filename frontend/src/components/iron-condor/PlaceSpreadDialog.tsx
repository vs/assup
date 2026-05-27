/**
 * Confirmation dialog for placing a spread combo order.
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/api";
import type { IronCondorOrderLeg, SpreadMode } from "@assup/shared";

interface PlaceSpreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  legs: IronCondorOrderLeg[];
  quantity: number;
  netCreditMid: number;
  maxLoss: number;
  mode: SpreadMode;
}

function spreadModeLabel(mode: SpreadMode): string {
  switch (mode) {
    case "put-spread": return "Put Spread";
    case "call-spread": return "Call Spread";
    case "iron-condor": return "Iron Condor";
  }
}

export function PlaceSpreadDialog({
  open,
  onOpenChange,
  symbol,
  legs,
  quantity,
  netCreditMid,
  maxLoss,
  mode,
}: PlaceSpreadDialogProps) {
  const [limitPrice, setLimitPrice] = useState(netCreditMid);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (open) {
      setLimitPrice(netCreditMid);
      setError(null);
      setSuccess(false);
    }
  }, [open, netCreditMid]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.ironCondor.placeOrder({ symbol, legs, quantity, limitPrice });
      setSuccess(true);
      setTimeout(() => { onOpenChange(false); setSuccess(false); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  const label = spreadModeLabel(mode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Place {label}</DialogTitle>
          <DialogDescription>
            Review and confirm your {symbol} {label.toLowerCase()} order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border rounded-lg p-3 space-y-1 text-sm">
            {legs.map((leg, i) => (
              <div key={i} className="flex justify-between">
                <span className={leg.side === "SELL" ? "font-semibold" : "text-muted-foreground"}>
                  {leg.side} {leg.type} {leg.strike}
                </span>
                <span className="text-muted-foreground">{"\u00D7"} {quantity}</span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Net Credit (Limit Price)</Label>
            <Input
              type="number"
              step="0.05"
              value={limitPrice}
              onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Max profit: ${(limitPrice * 100 * quantity).toLocaleString()} · Max loss: -${maxLoss.toLocaleString()}
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <AlertDescription className="text-green-600">Order submitted successfully!</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || success}>
              {submitting ? "Submitting..." : `Confirm \u2014 Credit $${(limitPrice * 100 * quantity).toLocaleString()}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
