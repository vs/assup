import { useState, useEffect } from "react";
import { api } from "@/api";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import type { CurrentOptionPosition, Order } from "@assup/shared";
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

interface ClosePositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: CurrentOptionPosition | null;
  existingOrder?: Order | null;
  onOrderPlaced?: () => void;
}

export function ClosePositionDialog({
  open,
  onOpenChange,
  position,
  existingOrder,
  onOrderPlaced,
}: ClosePositionDialogProps) {
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderId: number; message: string } | null>(null);
  const [quote, setQuote] = useState<{ bid: number | null; ask: number | null; mid: number | null } | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  const isModifyMode = !!existingOrder;

  // Closing a short position = BUY, closing a long position = SELL
  const action = position && position.quantity < 0 ? "BUY" : "SELL";

  // Reset state and fetch quote when dialog opens
  useEffect(() => {
    if (open && position) {
      setError(null);
      setSuccess(null);
      setQuote(null);

      // In modify mode, pre-fill from existing order
      if (existingOrder) {
        setQuantity(existingOrder.quantity);
        setLimitPrice(existingOrder.limitPrice ?? 0);
      } else {
        setQuantity(Math.abs(position.quantity));
      }

      const expiration = position.expiry.replace(/-/g, "");
      setLoadingQuote(true);
      api.orders
        .quote({
          symbol: position.underlying,
          expiration,
          strike: position.strike,
          right: position.right,
        })
        .then((q) => {
          setQuote(q);
          // Only set default price if NOT in modify mode (modify keeps existing price)
          if (!existingOrder) {
            const defaultPrice = position.quantity < 0
              ? (q.mid ?? q.ask ?? position.marketPrice)
              : (q.mid ?? q.bid ?? position.marketPrice);
            setLimitPrice(defaultPrice ?? 0);
          }
        })
        .catch(() => {
          if (!existingOrder) {
            setLimitPrice(position.marketPrice);
          }
        })
        .finally(() => setLoadingQuote(false));
    }
  }, [open, position, existingOrder]);

  const handleClose = () => {
    setError(null);
    setSuccess(null);
    onOpenChange(false);
  };

  const handleUseMid = () => {
    if (quote?.mid != null) {
      setLimitPrice(quote.mid);
    }
  };

  const handlePlaceOrder = async () => {
    if (!position) return;

    try {
      setPlacing(true);
      setError(null);

      if (isModifyMode && existingOrder) {
        const result = await api.orders.modify(existingOrder.orderId, {
          limitPrice,
          quantity,
        });
        setSuccess({ orderId: result.orderId, message: "Order modified successfully!" });
      } else {
        const result = await api.orders.place({
          symbol: position.underlying,
          expiration: position.expiry.replace(/-/g, ""),
          strike: position.strike,
          right: position.right,
          action,
          quantity,
          limitPrice,
        });
        setSuccess({ orderId: result.orderId, message: "Order placed successfully!" });
      }

      onOrderPlaced?.();

      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : isModifyMode ? "Failed to modify order" : "Failed to place order");
    } finally {
      setPlacing(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!existingOrder) return;

    try {
      setCancelling(true);
      setError(null);

      await api.orders.cancel(existingOrder.orderId);
      setSuccess({ orderId: existingOrder.orderId, message: "Order cancelled successfully!" });
      onOrderPlaced?.();

      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel order");
    } finally {
      setCancelling(false);
    }
  };

  if (!position) return null;

  const contractName = formatDisplayName({
    symbol: position.underlying,
    secType: "OPT",
    strike: position.strike,
    right: position.right,
    lastTradeDateOrContractMonth: position.expiry.replace(/-/g, ""),
  });

  const totalCost = quantity * limitPrice * 100;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isModifyMode ? "Adjust Order" : "Close Position"}</DialogTitle>
          <DialogDescription>
            {isModifyMode
              ? "Modify the limit price or quantity of your existing order"
              : `Place a LIMIT ${action.toLowerCase()} order to close this option position`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Contract info */}
          <div className="p-3 rounded-md bg-muted">
            <div className="font-medium">{contractName}</div>
            <div className="text-sm text-muted-foreground mt-1">
              {position.underlying} {formatCurrency(position.strike)} {position.right === "P" ? "PUT" : "CALL"} &middot; {position.expiry}
            </div>
          </div>

          {/* Current prices */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-sm text-muted-foreground">Bid</div>
              <div className="font-mono font-medium">
                {loadingQuote ? "..." : quote?.bid != null ? formatCurrency(quote.bid, { maximumFractionDigits: 2 }) : "-"}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Ask</div>
              <div className="font-mono font-medium">
                {loadingQuote ? "..." : quote?.ask != null ? formatCurrency(quote.ask, { maximumFractionDigits: 2 }) : "-"}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Mid</div>
              <div className="font-mono font-medium">
                {loadingQuote ? "..." : quote?.mid != null ? formatCurrency(quote.mid, { maximumFractionDigits: 2 }) : "-"}
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
                disabled={placing || quote?.mid == null}
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

          {/* Total cost */}
          <div className="p-3 rounded-md bg-primary/10 text-center">
            <div className="text-sm text-muted-foreground">
              Total {action === "BUY" ? "Cost (Debit)" : "Premium (Credit)"}
            </div>
            <div className="text-xl font-bold">
              {formatCurrency(totalCost, { maximumFractionDigits: 2 })}
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
              {success.message} Order ID: {success.orderId}
            </div>
          )}
        </div>

        <div className="flex justify-between mt-4">
          <div>
            {isModifyMode && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleCancelOrder}
                disabled={placing || cancelling}
              >
                {cancelling ? "Cancelling..." : "Cancel Order"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {isModifyMode ? "Close" : "Cancel"}
            </Button>
            <Button
              type="button"
              onClick={handlePlaceOrder}
              disabled={placing || cancelling || quantity < 1 || limitPrice <= 0}
            >
              {placing
                ? (isModifyMode ? "Modifying..." : "Placing...")
                : isModifyMode
                  ? "Modify Order"
                  : `${action === "BUY" ? "Buy" : "Sell"} to Close`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
