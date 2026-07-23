/**
 * Hedge Wizard Step 4: Order Confirmation
 * Final step where the user reviews and places the hedge order.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/api";
import type { ActiveSpread } from "@assup/shared";
import type { HedgeStrategy } from "@assup/shared";

/**
 * Index option symbol/tradingClass mapping — XSP options are listed under
 * SPX with tradingClass XSPW. The combo order endpoint handles this
 * server-side, but the single-leg /api/orders/place path needs both.
 */
const INDEX_OPTION_CONFIG: Record<string, { optionSymbol: string; tradingClass: string }> = {
  XSP: { optionSymbol: "SPX", tradingClass: "XSPW" },
};

interface HedgeOrderLeg {
  side: "BUY" | "SELL";
  strike: number;
  right: "P" | "C";
  conId: number;
}

interface HedgeOrderConfirmProps {
  spread: ActiveSpread;
  strategy: HedgeStrategy;
  orderLegs: HedgeOrderLeg[];
  limitPrice: number;
  quantity: number;
  beforeMaxLoss: number;
  afterMaxLoss: number;
  onBack: () => void;
  onSuccess: () => void;
}

/** Format YYYYMMDD expiry as MM/DD */
function formatExpiryShort(expiry: string): string {
  if (expiry.length !== 8) return expiry;
  const month = expiry.slice(4, 6);
  const day = expiry.slice(6, 8);
  return `${month}/${day}`;
}

function fmtDollars(v: number): string {
  return `$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Collect all unique strikes from spread legs + order legs, sorted */
function collectAllStrikes(spread: ActiveSpread, orderLegs: HedgeOrderLeg[]): number[] {
  const allStrikes = new Set<number>();
  for (const leg of spread.legs) allStrikes.add(leg.strike);
  for (const leg of orderLegs) allStrikes.add(leg.strike);
  return Array.from(allStrikes).sort((a, b) => a - b);
}

/** Build plain-english result description */
function buildResultDescription(
  spread: ActiveSpread,
  strategy: HedgeStrategy,
  orderLegs: HedgeOrderLeg[],
): string {
  const allStrikes = collectAllStrikes(spread, orderLegs);
  const isPut = spread.legs.some((l) => l.right === "P");
  const rightLabel = isPut ? "put" : "call";

  if (strategy === "butterfly") {
    const strikesLabel = allStrikes.join("/");
    return `Your ${rightLabel} credit spread becomes a ${strikesLabel} ${rightLabel} butterfly`;
  } else if (strategy === "roll") {
    const closeLeg = orderLegs.find((l) => l.side === "BUY");
    const newLeg = orderLegs.find((l) => l.side === "SELL");
    return `Your short ${rightLabel} rolls from ${closeLeg?.strike ?? "?"} to ${newLeg?.strike ?? "?"}`;
  } else {
    const existingStrikes = new Set(spread.legs.map((l) => l.strike));
    const newLeg = orderLegs.find((l) => !existingStrikes.has(l.strike)) ?? orderLegs[0];
    const protectiveStrike = newLeg?.strike ?? 0;
    return `Your spread gets a protective ${rightLabel} at ${protectiveStrike}`;
  }
}

export function HedgeOrderConfirm({
  spread,
  strategy,
  orderLegs,
  limitPrice,
  quantity,
  beforeMaxLoss,
  afterMaxLoss,
  onBack,
  onSuccess,
}: HedgeOrderConfirmProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const hasValidConIds = orderLegs.every(l => l.conId > 0);
  const totalCost = limitPrice * 100 * quantity;
  const expiryLabel = formatExpiryShort(spread.expiry);
  const resultDescription = buildResultDescription(spread, strategy, orderLegs);

  const handlePlaceOrder = async () => {
    setSubmitting(true);
    setError(null);

    try {
      if (strategy === "roll") {
        // Roll: two sequential orders — close current short, then open new short.
        const mapping = INDEX_OPTION_CONFIG[spread.symbol];
        const baseProps = {
          symbol: mapping?.optionSymbol ?? spread.symbol,
          expiration: spread.expiry,
          ...(mapping?.tradingClass ? { tradingClass: mapping.tradingClass } : {}),
        };

        const closeLeg = orderLegs.find((l) => l.side === "BUY");
        const newLeg = orderLegs.find((l) => l.side === "SELL");

        if (!closeLeg || !newLeg) throw new Error("Roll requires both close and open legs");

        // Step 1: Close current short leg
        await api.orders.place({
          ...baseProps,
          strike: closeLeg.strike,
          right: closeLeg.right,
          action: "BUY",
          quantity,
          limitPrice,
        });

        // Step 2: Open new short leg
        // Derive a limit from the close leg's mid price minus the net roll debit,
        // so the new short doesn't sell at an unfavorable market price.
        const shortLegData = spread.legs.find((l) => l.side === "SELL");
        const shortMid = shortLegData?.midPrice ?? 0;
        const newShortLimit = Math.max(0.05, Math.round((shortMid - limitPrice) * 100) / 100);
        try {
          await api.orders.place({
            ...baseProps,
            strike: newLeg.strike,
            right: newLeg.right,
            action: "SELL",
            quantity,
            limitPrice: newShortLimit,
          });
        } catch (err) {
          setError(`Close order submitted but new short leg failed: ${err instanceof Error ? err.message : "Unknown error"}. Check open orders.`);
          setSubmitting(false);
          return;
        }
      } else if (strategy === "butterfly") {
        const legs = orderLegs.map((leg) => ({
          conId: leg.conId,
          strike: leg.strike,
          type: (leg.right === "P" ? "PUT" : "CALL") as "PUT" | "CALL",
          side: leg.side,
          expiration: spread.expiry,
          exchange: "SMART" as const,
        }));

        await api.ironCondor.placeOrder({
          symbol: spread.symbol,
          legs,
          quantity,
          limitPrice,
        });
      } else {
        const leg = orderLegs[0];
        const mapping = INDEX_OPTION_CONFIG[spread.symbol];
        await api.orders.place({
          symbol: mapping?.optionSymbol ?? spread.symbol,
          expiration: spread.expiry,
          strike: leg.strike,
          right: leg.right,
          action: "BUY",
          quantity,
          limitPrice,
          ...(mapping?.tradingClass ? { tradingClass: mapping.tradingClass } : {}),
        });
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <p className="text-sm font-semibold">Confirm Hedge Order</p>

      {/* Order summary box */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 overflow-hidden">
        <div className="px-3 py-2 border-b border-blue-200">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
            Order Summary
          </span>
        </div>

        <div className="divide-y divide-blue-100">
          {orderLegs.map((leg, idx) => {
            const isBuy = leg.side === "BUY";
            const rightLabel = leg.right === "P" ? "PUT" : "CALL";
            return (
              <div
                key={idx}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <Badge variant={isBuy ? "success" : "danger"}>{leg.side}</Badge>
                <span className="tabular-nums text-muted-foreground">
                  &times;{quantity}
                </span>
                <span className="font-semibold">{spread.symbol}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {expiryLabel}
                </span>
                <span className="font-mono">{leg.strike}</span>
                <span className="text-muted-foreground text-xs">{rightLabel}</span>
              </div>
            );
          })}
        </div>

        {/* Footer row */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-blue-200 bg-blue-100/50 text-sm">
          <span className="text-muted-foreground text-xs">
            {strategy === "roll" ? "Net roll debit limit:" : "Combo debit limit:"}{" "}
            <span className="font-mono font-medium">${limitPrice.toFixed(2)}</span>
          </span>
          <span className="font-semibold text-red-600">
            Total cost: {fmtDollars(totalCost)}
          </span>
        </div>
      </div>

      {/* Plain-english explanation */}
      <div className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground text-xs uppercase tracking-wider mb-1">
          After this order fills:
        </p>
        <p>
          {resultDescription}
          {afterMaxLoss < beforeMaxLoss ? (
            <> with max loss reduced from{" "}
              <span className="font-semibold text-red-700">{fmtDollars(beforeMaxLoss)}</span>{" "}
              to{" "}
              <span className="font-semibold text-green-700">{fmtDollars(afterMaxLoss)}</span>.</>
          ) : afterMaxLoss > beforeMaxLoss ? (
            <>. Max loss from here increases from{" "}
              <span className="font-semibold text-red-700">{fmtDollars(beforeMaxLoss)}</span>{" "}
              to{" "}
              <span className="font-semibold text-red-700">{fmtDollars(afterMaxLoss)}</span>
              , but provides tail-risk protection beyond the spread.</>
          ) : (
            <> with max loss unchanged at{" "}
              <span className="font-semibold text-red-700">{fmtDollars(afterMaxLoss)}</span>.</>
          )}
        </p>
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success alert */}
      {success && (
        <Alert>
          <AlertDescription className="text-green-600">
            Hedge order submitted successfully!
          </AlertDescription>
        </Alert>
      )}

      {/* Footer */}
      <div className="flex justify-between pt-1">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={submitting || success}
        >
          &larr; Back
        </Button>
        <div className="flex flex-col items-end gap-1">
          {!hasValidConIds && (
            <span className="text-xs text-destructive">
              Missing contract IDs -- quotes not yet loaded
            </span>
          )}
          <Button
            size="lg"
            onClick={handlePlaceOrder}
            disabled={submitting || success || !hasValidConIds}
          >
            {submitting
              ? "Submitting..."
              : `Place Hedge Order \u2014 Debit ${fmtDollars(totalCost)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
