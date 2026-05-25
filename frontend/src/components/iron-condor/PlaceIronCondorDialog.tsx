/**
 * Confirmation dialog for placing an iron condor combo order.
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
import type { IronCondorOrderLeg } from "@assup/shared";

interface PlaceIronCondorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  legs: IronCondorOrderLeg[];
  quantity: number;
  netCreditMid: number;
  maxLoss: number;
}

export function PlaceIronCondorDialog({
  open,
  onOpenChange,
  symbol,
  legs,
  quantity,
  netCreditMid,
  maxLoss,
}: PlaceIronCondorDialogProps) {
  const [limitPrice, setLimitPrice] = useState(netCreditMid);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when dialog opens or credit changes
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
      await api.ironCondor.placeOrder({
        symbol,
        legs,
        quantity,
        limitPrice,
      });
      setSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Place Iron Condor</DialogTitle>
          <DialogDescription>
            Review and confirm your {symbol} iron condor order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Legs summary */}
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

          {/* Limit price */}
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
