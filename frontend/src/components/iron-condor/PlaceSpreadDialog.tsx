/**
 * Confirmation dialog for placing a spread combo order.
 * Allows per-leg strike adjustment with live bid/ask/mid/delta display.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/api";
import type { IronCondorOrderLeg, IronCondorChainStrike, SpreadMode } from "@assup/shared";
import { spreadModeLabel } from "./utils";

interface PlaceSpreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  legs: IronCondorOrderLeg[];
  quantity: number;
  netCreditMid: number;
  maxLoss: number;
  mode: SpreadMode;
  chain: IronCondorChainStrike[];
}

function getOption(chain: IronCondorChainStrike[], strike: number, type: "PUT" | "CALL") {
  const entry = chain.find(c => c.strike === strike);
  return type === "PUT" ? entry?.put : entry?.call;
}

/** Compute net credit mid from legs: sum of sell mids minus sum of buy mids */
function computeNetCreditMid(editableLegs: IronCondorOrderLeg[], chain: IronCondorChainStrike[]): number {
  let net = 0;
  for (const leg of editableLegs) {
    const option = getOption(chain, leg.strike, leg.type);
    const mid = option?.mid ?? 0;
    net += leg.side === "SELL" ? mid : -mid;
  }
  return Math.round(net * 100) / 100;
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
  chain,
}: PlaceSpreadDialogProps) {
  const [editableLegs, setEditableLegs] = useState<IronCondorOrderLeg[]>(legs);
  const [limitPrice, setLimitPrice] = useState(netCreditMid);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when dialog opens or initial legs change
  useEffect(() => {
    if (open) {
      setEditableLegs(legs);
      setLimitPrice(netCreditMid);
      setError(null);
      setSuccess(false);
    }
  }, [open, legs, netCreditMid]);

  // Available strikes from chain, sorted
  const availableStrikes = useMemo(() => chain.map(c => c.strike).sort((a, b) => a - b), [chain]);

  // Update a leg's strike and recalculate net credit
  const handleStrikeChange = useCallback((index: number, newStrike: number) => {
    setEditableLegs(prev => {
      const updated = prev.map((leg, i) => {
        if (i !== index) return leg;
        const option = getOption(chain, newStrike, leg.type);
        return {
          ...leg,
          strike: newStrike,
          conId: option?.conId ?? 0,
        };
      });
      // Recalculate limit price from new net credit mid
      setLimitPrice(computeNetCreditMid(updated, chain));
      return updated;
    });
  }, [chain]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Negate limitPrice: UI shows positive credit, but IBKR BAG BUY LMT
      // needs negative price to enforce minimum credit received.
      await api.ironCondor.placeOrder({ symbol, legs: editableLegs, quantity, limitPrice: -limitPrice });
      setSuccess(true);
      setTimeout(() => { onOpenChange(false); setSuccess(false); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setSubmitting(false);
    }
  };

  const label = spreadModeLabel(mode);
  const currentNetCredit = computeNetCreditMid(editableLegs, chain);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Place {label}</DialogTitle>
          <DialogDescription>
            Review and adjust your {symbol} {label.toLowerCase()} order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Per-leg editors */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-1 text-[10px] text-muted-foreground uppercase font-medium px-1">
              <span>Leg</span>
              <span className="w-[90px] text-center">Strike</span>
              <span className="w-12 text-right">Bid</span>
              <span className="w-12 text-right">Ask</span>
              <span className="w-12 text-right">Mid</span>
            </div>
            {editableLegs.map((leg, i) => {
              const option = getOption(chain, leg.strike, leg.type);
              const isSell = leg.side === "SELL";
              return (
                <div
                  key={`${leg.type}-${leg.side}`}
                  className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center py-1.5 px-1 rounded ${isSell ? "bg-amber-50" : ""}`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      leg.type === "PUT"
                        ? (isSell ? "bg-red-100 text-red-700" : "bg-red-50 text-red-500")
                        : (isSell ? "bg-green-100 text-green-700" : "bg-green-50 text-green-500")
                    }`}>
                      {leg.side}
                    </span>
                    <span className={isSell ? "font-semibold" : "text-muted-foreground"}>{leg.type}</span>
                    {option?.delta != null && (
                      <span className="text-[10px] text-muted-foreground">{"\u03B4"}{(option.delta * 100).toFixed(1)}</span>
                    )}
                  </div>
                  <Select
                    value={String(leg.strike)}
                    onValueChange={(v) => handleStrikeChange(i, parseFloat(v))}
                  >
                    <SelectTrigger className="w-[90px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {availableStrikes.map(s => {
                        const opt = getOption(chain, s, leg.type);
                        if (!opt) return null;
                        return (
                          <SelectItem key={s} value={String(s)} className="text-xs">
                            {s}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <span className="w-12 text-right text-xs tabular-nums">{option?.bid?.toFixed(2) ?? "\u2014"}</span>
                  <span className="w-12 text-right text-xs tabular-nums">{option?.ask?.toFixed(2) ?? "\u2014"}</span>
                  <span className={`w-12 text-right text-xs font-medium tabular-nums ${isSell ? "text-green-600" : "text-red-600"}`}>
                    {option?.mid?.toFixed(2) ?? "\u2014"}
                  </span>
                </div>
              );
            })}
            {/* Net credit summary */}
            <div className="border-t pt-2 mt-1 flex justify-between items-center text-xs px-1">
              <span className="text-muted-foreground font-medium">Net Credit (mid):</span>
              <span className={`font-semibold ${currentNetCredit > 0 ? "text-green-600" : "text-red-600"}`}>
                ${currentNetCredit.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Limit price */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Limit Price</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setLimitPrice(currentNetCredit)}
              >
                Use Mid
              </Button>
            </div>
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
