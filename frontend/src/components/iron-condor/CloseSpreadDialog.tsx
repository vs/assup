/**
 * Confirmation dialog for closing a spread via combo order.
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
import type { ActiveSpread, SpreadMode } from "@assup/shared";

interface CloseSpreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  onSuccess: () => void;
}

function spreadModeLabel(mode: SpreadMode): string {
  switch (mode) {
    case "put-spread": return "Put Spread";
    case "call-spread": return "Call Spread";
    case "iron-condor": return "Iron Condor";
  }
}

export function CloseSpreadDialog({ open, onOpenChange, spread, onSuccess }: CloseSpreadDialogProps) {
  const [limitPrice, setLimitPrice] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (open && spread) {
      setLimitPrice(spread.closeMidPrice ?? 0);
      setError(null);
      setSuccess(false);
    }
  }, [open, spread]);

  if (!spread) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Build closing legs: flip side (SELL -> BUY, BUY -> SELL)
      const closingLegs = spread.legs.map(leg => ({
        conId: leg.conId,
        strike: leg.strike,
        type: (leg.right === "P" ? "PUT" : "CALL") as "PUT" | "CALL",
        side: (leg.side === "SELL" ? "BUY" : "SELL") as "BUY" | "SELL",
        expiration: spread.expiry,
        exchange: leg.exchange,
      }));

      await api.ironCondor.closeSpread({
        symbol: spread.symbol,
        legs: closingLegs,
        quantity: spread.quantity,
        limitPrice,
      });
      setSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  const label = spreadModeLabel(spread.type);
  const maxCost = limitPrice * 100 * spread.quantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close {label}</DialogTitle>
          <DialogDescription>
            Review and confirm your {spread.symbol} closing order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Legs summary — show flipped actions */}
          <div className="border rounded-lg p-3 space-y-1 text-sm">
            {spread.legs.map((leg) => {
              const closingSide = leg.side === "SELL" ? "BUY" : "SELL";
              return (
                <div key={leg.conId} className="flex justify-between">
                  <span className={closingSide === "BUY" ? "font-semibold" : "text-muted-foreground"}>
                    {closingSide} {leg.right === "P" ? "PUT" : "CALL"} {leg.strike}
                  </span>
                  <span className="text-muted-foreground">{"\u00D7"} {spread.quantity}</span>
                </div>
              );
            })}
          </div>

          {/* Limit price */}
          <div className="space-y-2">
            <Label>Net Debit (Limit Price)</Label>
            <Input
              type="number"
              step="0.05"
              min="0"
              value={limitPrice}
              onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">
              Max cost: ${maxCost.toLocaleString()}
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <AlertDescription className="text-green-600">Close order submitted successfully!</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || success}>
              {submitting ? "Submitting..." : `Confirm \u2014 Debit $${maxCost.toLocaleString()}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
