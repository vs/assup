/**
 * Roll Out Dialog: closes a breached call/put credit spread and opens a new one
 * at higher (calls) or lower (puts) strikes at a later expiration.
 */

import { useState, useEffect, useMemo } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownUp } from "lucide-react";
import type { ActiveSpread } from "@assup/shared";
import { spreadModeLabel } from "./utils";
import { api } from "@/api";
import { useSpreadsStream } from "@/hooks/useSpreadsStream";
import { defaultTargetExpiration, expirationsBeyond, calendarDaysBetween, formatExpiry, fmtCurrency, availableStrikesForRight, deriveWingWidth, defaultNewShortStrike, snapToNearestStrike, snapWingWidth, strikeIntervals, buildQuotesFromChain } from "./rollOutHelpers";

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
  const [quantity, setQuantity] = useState(0);
  const [newShortStrike, setNewShortStrike] = useState(0);
  const [wingWidth, setWingWidth] = useState(0);

  // Reset state on open / spread change
  useEffect(() => {
    if (open && spread) {
      setError(null);
      setTargetExpiration(null);
      setAllExpirations([]);
      setExpirationsLoading(false);
      setQuantity(spread.quantity);
      setNewShortStrike(0);
      setWingWidth(deriveWingWidth(spread));
    }
  }, [open, spread?.id, spread?.quantity]);

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

  // Compute focus range for the chain stream — covers the spread's strikes plus
  // a generous window in the roll direction so the new short candidate has dense quotes.
  // (placement: layout position 2 — plain consts that hooks below depend on)
  const isPut = spread?.type === "put-spread";
  const focusRange = useMemo(() => {
    if (!spread) return undefined;
    const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
    const lo = strikes[0];
    const hi = strikes[strikes.length - 1];
    const wing = deriveWingWidth(spread);
    const span = Math.max(wing * 6, (hi - lo) * 3, 20);
    return isPut ? { min: lo - span, max: hi } : { min: lo, max: hi + span };
    // Key on spread?.id (not the object identity) so polling-refreshed parent
    // state doesn't churn the focus range and reconnect the stream every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spread?.id, isPut]);

  const streamMode = isPut ? "put-spread" : "call-spread";
  const streamEnabled = open && !!spread && !!targetExpiration;
  const stream = useSpreadsStream(
    spread?.symbol ?? "",
    targetExpiration ?? undefined,
    undefined,         // selectedStrikes
    focusRange,
    undefined,         // targetPutDelta
    undefined,         // targetCallDelta
    undefined,         // wingWidth
    streamMode,
    2000,              // updateIntervalMs
    streamEnabled,
  );

  const newAvailableStrikes = useMemo(
    () => availableStrikesForRight(stream.chain, isPut ? "P" : "C"),
    [stream.chain, isPut],
  );

  const newQuotes = useMemo(() => buildQuotesFromChain(stream.chain), [stream.chain]);

  const connected = stream.status === "connected" && stream.chain.length > 0;

  // When the chain becomes available (or expiration changes), seed the new short
  // strike from a delta-target heuristic, then snap to the nearest strike.
  useEffect(() => {
    if (!spread || !connected || newAvailableStrikes.length === 0) return;
    const currentShortLeg = spread.legs.find(l => l.side === "SELL");
    const currentShortDelta = currentShortLeg
      ? Math.abs(newQuotes.get(`${currentShortLeg.strike}:${currentShortLeg.right}`)?.delta ?? 0)
      : 0;
    const targetAbsDelta = currentShortDelta > 0 ? currentShortDelta : 0.30;

    setNewShortStrike(prev => {
      // Don't overwrite a user-selected strike unless it's not in the new chain
      if (prev > 0 && newAvailableStrikes.includes(prev)) return prev;
      const def = defaultNewShortStrike(stream.chain, !!isPut, targetAbsDelta, stream.underlyingPrice);
      return def > 0 ? snapToNearestStrike(def, newAvailableStrikes) : prev;
    });

    setWingWidth(prev => {
      const intervals = strikeIntervals(newAvailableStrikes);
      if (intervals.length === 0) return prev;
      // Prefer the existing wing width; if not available, snap to nearest larger.
      return snapWingWidth(prev > 0 ? prev : deriveWingWidth(spread), intervals);
    });
  }, [connected, newAvailableStrikes, stream.chain, stream.underlyingPrice, isPut, spread, newQuotes]);

  if (!spread) return null;

  // Derived new long strike — snapped to chain.
  const proposedLongStrike = isPut
    ? newShortStrike - wingWidth
    : newShortStrike + wingWidth;
  const newLongStrike = newAvailableStrikes.length > 0
    ? snapToNearestStrike(proposedLongStrike, newAvailableStrikes)
    : proposedLongStrike;

  // Available wing widths (intervals present in the chain)
  const wingOptions = (() => {
    const intervals = strikeIntervals(newAvailableStrikes);
    const existing = deriveWingWidth(spread);
    if (existing > 0 && !intervals.includes(existing)) intervals.push(existing);
    return intervals.sort((a, b) => a - b);
  })();

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

          {/* Connection indicator */}
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-yellow-400"}`} />
            <span className="text-xs text-muted-foreground">
              {connected ? `Live quotes (${newAvailableStrikes.length} strikes)` : targetExpiration ? "Loading chain..." : "Pick a target expiration"}
            </span>
          </div>

          {/* Quantity / strikes / wing controls */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Quantity to roll</Label>
              <Input
                type="number"
                min={1}
                max={spread.quantity}
                value={quantity}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (Number.isNaN(v)) return;
                  setQuantity(Math.max(1, Math.min(spread.quantity, v)));
                }}
                className="w-full"
              />
              <span className="text-[10px] text-muted-foreground">max {spread.quantity}</span>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Wing width</Label>
              <Select
                value={String(wingWidth)}
                onValueChange={(v) => setWingWidth(Number(v))}
                disabled={!connected || wingOptions.length === 0}
              >
                <SelectTrigger className="w-full font-mono">
                  <SelectValue placeholder="Wing" />
                </SelectTrigger>
                <SelectContent>
                  {wingOptions.map(w => (
                    <SelectItem key={w} value={String(w)}>{w}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-1">
              <Label className="text-xs">New short strike</Label>
              <Select
                value={String(newShortStrike)}
                onValueChange={(v) => setNewShortStrike(Number(v))}
                disabled={!connected || newAvailableStrikes.length === 0}
              >
                <SelectTrigger className="w-full font-mono">
                  <SelectValue placeholder="Strike" />
                </SelectTrigger>
                <SelectContent>
                  {(isPut ? [...newAvailableStrikes].reverse() : newAvailableStrikes).map(s => (
                    <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-1">
              <Label className="text-xs">New long strike</Label>
              <div className="h-9 px-3 flex items-center text-sm font-mono rounded-md border bg-muted">
                {newLongStrike || "—"}
              </div>
              <span className="text-[10px] text-muted-foreground">auto: short {isPut ? "−" : "+"} wing</span>
            </div>
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
