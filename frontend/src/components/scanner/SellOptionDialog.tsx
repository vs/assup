import { useState, useEffect } from "react";
import { api } from "@/api";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import type { ExtendedOptionOpportunity } from "./types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SellOptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: ExtendedOptionOpportunity | null;
  onOrderPlaced?: () => void;
}

/**
 * Format expiration from YYYYMMDD to readable date
 */
function formatExpiration(expiration: string): string {
  if (expiration.length !== 8) return expiration;
  const year = expiration.substring(0, 4);
  const month = expiration.substring(4, 6);
  const day = expiration.substring(6, 8);
  return `${year}-${month}-${day}`;
}

export function SellOptionDialog({
  open,
  onOpenChange,
  opportunity,
  onOrderPlaced,
}: SellOptionDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderId: number } | null>(null);

  // Reset state when dialog opens with new opportunity
  useEffect(() => {
    if (open && opportunity) {
      setQuantity(1);
      setLimitPrice(opportunity.midPrice);
      setError(null);
      setSuccess(null);
    }
  }, [open, opportunity]);

  const handleClose = () => {
    setError(null);
    setSuccess(null);
    onOpenChange(false);
  };

  const handleUseMid = () => {
    if (opportunity) {
      setLimitPrice(opportunity.midPrice);
    }
  };

  const handlePlaceOrder = async () => {
    if (!opportunity) return;

    try {
      setPlacing(true);
      setError(null);

      const result = await api.orders.place({
        symbol: opportunity.symbol,
        expiration: opportunity.expiration,
        strike: opportunity.strike,
        right: opportunity.optionType === "PUT" ? "P" : "C",
        action: "SELL",
        quantity,
        limitPrice,
      });

      setSuccess({ orderId: result.orderId });
      onOrderPlaced?.();

      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setPlacing(false);
    }
  };

  if (!opportunity) return null;

  const contractName = formatDisplayName({
    symbol: opportunity.symbol,
    secType: "OPT",
    strike: opportunity.strike,
    right: opportunity.optionType === "PUT" ? "P" : "C",
    lastTradeDateOrContractMonth: opportunity.expiration,
  });

  const totalPremium = quantity * limitPrice * 100;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sell Option</DialogTitle>
          <DialogDescription>
            Place a LIMIT sell order for this option contract
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contract info */}
          <div className="p-3 rounded-md bg-muted">
            <div className="font-medium">{contractName}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {opportunity.symbol} {formatCurrency(opportunity.strike)} {opportunity.optionType} &middot; {formatExpiration(opportunity.expiration)}
            </div>
          </div>

          {/* Current prices */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-sm text-muted-foreground">Bid</div>
              <div className="font-mono font-medium">
                {formatCurrency(opportunity.bid, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Ask</div>
              <div className="font-mono font-medium">
                {formatCurrency(opportunity.ask, { maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Mid</div>
              <div className="font-mono font-medium">
                {formatCurrency(opportunity.midPrice, { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Quantity input */}
          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity (contracts)</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={placing}
            />
          </div>

          {/* Limit price input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="limitPrice">Limit Price</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUseMid}
                disabled={placing}
              >
                Use Mid
              </Button>
            </div>
            <Input
              id="limitPrice"
              type="number"
              step="0.01"
              min={0.01}
              value={limitPrice}
              onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
              disabled={placing}
            />
          </div>

          {/* Total premium */}
          <div className="p-3 rounded-md bg-primary/10 text-center">
            <div className="text-sm text-muted-foreground">Total Premium (Credit)</div>
            <div className="text-xl font-bold">
              {formatCurrency(totalPremium, { maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Success message */}
          {success && (
            <div className="p-3 rounded-md bg-green-500/10 text-green-600 text-sm">
              Order placed successfully! Order ID: {success.orderId}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handlePlaceOrder}
            disabled={placing || quantity < 1 || limitPrice <= 0}
          >
            {placing ? "Placing..." : "Place Order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
