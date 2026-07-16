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
import type { ActiveSpread } from "@assup/shared";
import { spreadModeLabel } from "./utils";

interface CloseSpreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spread: ActiveSpread | null;
  onSuccess: () => void;
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
          {/* Legs summary — show flipped actions with prices */}
          <div className="border rounded-lg p-3 space-y-1 text-sm">
            {spread.legs.map((leg) => {
              const closingSide = leg.side === "SELL" ? "BUY" : "SELL";
              const isBuy = closingSide === "BUY";
              return (
                <div key={leg.conId} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      isBuy ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
                    }`}>
                      {closingSide}
                    </span>
                    <span className={isBuy ? "font-semibold" : "text-muted-foreground"}>
                      {leg.right === "P" ? "PUT" : "CALL"} {leg.strike}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 tabular-nums">
                    {leg.midPrice != null && leg.midPrice !== 0 ? (
                      <span className={`text-xs ${isBuy ? "text-red-600" : "text-green-600"}`}>
                        ${Math.abs(leg.midPrice).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">no price</span>
                    )}
                    <span className="text-muted-foreground">{"\u00D7"} {spread.quantity}</span>
                  </div>
                </div>
              );
            })}
            {/* Net close price */}
            <div className="border-t pt-2 mt-2 flex justify-between text-xs">
              <span className="text-muted-foreground font-medium">Net Debit (from positions):</span>
              <span className="font-semibold tabular-nums">
                {spread.closeMidPrice != null && spread.closeMidPrice !== 0
                  ? `$${spread.closeMidPrice.toFixed(2)}`
                  : "unavailable"}
              </span>
            </div>
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
