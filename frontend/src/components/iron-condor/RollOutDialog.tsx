/**
 * Roll Out Dialog: closes a breached call/put credit spread and opens a new one
 * at higher (calls) or lower (puts) strikes at a later expiration.
 */

import { useState, useEffect, useMemo, useRef } from "react";
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
import {
  buildQuotesFromChain,
  availableStrikesForRight,
  deriveWingWidth,
  defaultTargetExpiration,
  expirationsBeyond,
  calendarDaysBetween,
  defaultNewShortStrike,
  snapToNearestStrike,
  snapWingWidth,
  strikeIntervals,
  computeRollEconomicsMid,
  formatExpiry,
  fmtCurrency,
  summarizeExisting,
  summarizeNewSpread,
  buildCloseLegs,
  buildOpenLegs,
} from "./rollOutHelpers";
import type { ChainQuote } from "./rollOutHelpers";

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

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function LegQuoteRow({ side, strike, right, quote }: {
  side: "BUY" | "SELL";
  strike: number;
  right: "P" | "C";
  quote: ChainQuote | undefined;
}) {
  return (
    <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto] gap-x-3 items-center px-3 py-1.5 text-sm">
      <Badge variant={side === "SELL" ? "danger" : "success"}>{side}</Badge>
      <span className="font-mono font-medium">{strike}</span>
      <span className="text-muted-foreground text-xs">{right === "P" ? "PUT" : "CALL"}</span>
      <span className="text-right tabular-nums text-xs">
        <span className="text-[10px] text-muted-foreground mr-1">bid</span>{fmt(quote?.bid)}
      </span>
      <span className="text-right tabular-nums text-xs">
        <span className="text-[10px] text-muted-foreground mr-1">ask</span>{fmt(quote?.ask)}
      </span>
      <span className="text-right tabular-nums text-xs w-14">
        <span className="text-[10px] text-muted-foreground mr-1">&delta;</span>{fmt(quote?.delta)}
      </span>
    </div>
  );
}

export function RollOutDialog({ open, onOpenChange, spread, onSuccess }: RollOutDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [allExpirations, setAllExpirations] = useState<string[]>([]);
  const [targetExpiration, setTargetExpiration] = useState<string | null>(null);
  const [expirationsLoading, setExpirationsLoading] = useState(false);
  const [quantity, setQuantity] = useState(0);
  const [newShortStrike, setNewShortStrike] = useState(0);
  const [wingWidth, setWingWidth] = useState(0);
  const [closeLimit, setCloseLimit] = useState(0);
  const [openLimit, setOpenLimit] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const closeLimitSeeded = useRef(false);
  const openLimitSeeded = useRef(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state on open / spread change
  useEffect(() => {
    if (open && spread) {
      setError(null);
      setWarning(null);
      setSuccess(false);
      setTargetExpiration(null);
      setAllExpirations([]);
      setExpirationsLoading(false);
      setQuantity(spread.quantity);
      setNewShortStrike(0);
      setWingWidth(deriveWingWidth(spread));
      setCloseLimit(0);
      setOpenLimit(0);
      closeLimitSeeded.current = false;
      openLimitSeeded.current = false;
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

  const newQuotes = useMemo(
    () => buildQuotesFromChain(stream.chain),
    [stream.chain],
  );

  const connected = stream.status === "connected" && stream.chain.length > 0;

  // Derived new long strike — snapped to chain. Declared here (above the next
  // useEffect / future Task 6 useMemos) so any hook that depends on it can
  // include it in its dep array safely.
  const proposedLongStrike = isPut
    ? newShortStrike - wingWidth
    : newShortStrike + wingWidth;
  const newLongStrike = newAvailableStrikes.length > 0
    ? snapToNearestStrike(proposedLongStrike, newAvailableStrikes)
    : proposedLongStrike;

  // Per-contract close debit at mid (uses spread leg mid prices already on the spread).
  const seedCloseDebit = useMemo(() => {
    if (!spread) return 0;
    const shortMid = spread.legs.find(l => l.side === "SELL")?.midPrice ?? 0;
    const longMid = spread.legs.find(l => l.side === "BUY")?.midPrice ?? 0;
    return Math.max(0, shortMid - longMid);
  }, [spread]);

  // Per-contract open credit at mid (uses live streamed quotes for the new strikes).
  const seedOpenCredit = useMemo(() => {
    if (!spread || newShortStrike === 0 || newLongStrike === 0) return 0;
    const right: "P" | "C" = isPut ? "P" : "C";
    const sMid = newQuotes.get(`${newShortStrike}:${right}`)?.mid ?? 0;
    const lMid = newQuotes.get(`${newLongStrike}:${right}`)?.mid ?? 0;
    return Math.max(0, sMid - lMid);
  }, [spread, newShortStrike, newLongStrike, isPut, newQuotes]);

  // When the chain becomes available (or expiration changes), seed the new short
  // strike from a 30-delta heuristic, then snap to the nearest strike. We don't
  // have the current short leg's delta directly (ActiveSpreadLeg has no delta
  // field), so 0.30 is the spec-defined fallback.
  useEffect(() => {
    if (!spread || !connected || newAvailableStrikes.length === 0) return;

    setNewShortStrike(prev => {
      // Don't overwrite a user-selected strike unless it's not in the new chain
      if (prev > 0 && newAvailableStrikes.includes(prev)) return prev;
      const def = defaultNewShortStrike(stream.chain, !!isPut, 0.30, stream.underlyingPrice);
      return def > 0 ? snapToNearestStrike(def, newAvailableStrikes) : prev;
    });

    setWingWidth(prev => {
      // Once the user (or the initial seed) has set a wing > 0, leave it alone.
      // The chain ticks every 2s; re-snapping here would clobber a valid pick
      // like 5 down to 2.5 just because the literal adjacent-strike gaps don't
      // include 5 (a 5-wide spread is still achievable by skipping a strike).
      if (prev > 0) return prev;
      const intervals = strikeIntervals(newAvailableStrikes);
      if (intervals.length === 0) return prev;
      return snapWingWidth(deriveWingWidth(spread), intervals);
    });
  }, [connected, newAvailableStrikes, stream.chain, stream.underlyingPrice, isPut, spread]);

  // Seed close limit exactly once per dialog open, when a positive mid arrives.
  // Using a ref sentinel so subsequent user edits (including manually typing 0)
  // don't trigger re-seeding from the dependency array.
  useEffect(() => {
    if (!closeLimitSeeded.current && seedCloseDebit > 0) {
      closeLimitSeeded.current = true;
      setCloseLimit(Math.round(seedCloseDebit * 100) / 100);
    }
  }, [seedCloseDebit]);

  useEffect(() => {
    if (!openLimitSeeded.current && seedOpenCredit > 0) {
      openLimitSeeded.current = true;
      setOpenLimit(Math.round(seedOpenCredit * 100) / 100);
    }
  }, [seedOpenCredit]);

  // Clear the post-success timer if the dialog unmounts before it fires,
  // so we don't call onOpenChange/onSuccess on stale closures.
  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, []);

  if (!spread) return null;

  // Available wing widths (intervals present in the chain) — uses `spread.legs`
  // directly via `deriveWingWidth`, so kept after the null check.
  const wingOptions = (() => {
    const intervals = strikeIntervals(newAvailableStrikes);
    const existing = deriveWingWidth(spread);
    if (existing > 0 && !intervals.includes(existing)) intervals.push(existing);
    return intervals.sort((a, b) => a - b);
  })();

  // Quotes for the current spread's legs (from the existing leg snapshot).
  const currentQuotes: Map<string, ChainQuote> = (() => {
    const m = new Map<string, ChainQuote>();
    for (const leg of spread.legs) {
      m.set(`${leg.strike}:${leg.right}`, {
        strike: leg.strike,
        right: leg.right,
        conId: leg.conId,
        bid: null,
        ask: null,
        mid: leg.midPrice,
        delta: null,
      });
    }
    return m;
  })();

  // Display economics — mirrors the seed values but reuses the helper for symmetry.
  const economics = computeRollEconomicsMid(
    spread,
    newShortStrike,
    newLongStrike,
    isPut ? "P" : "C",
    newQuotes,
    currentQuotes,
  );

  const beforeSummary = summarizeExisting(spread);
  const afterSummary = summarizeNewSpread(
    newShortStrike,
    newLongStrike,
    !!isPut,
    openLimit,
    quantity,
  );

  const directionLabel = isPut ? "Roll Down & Out" : "Roll Up & Out";

  const newShortQuote = newQuotes.get(`${newShortStrike}:${isPut ? "P" : "C"}`);
  const newLongQuote = newQuotes.get(`${newLongStrike}:${isPut ? "P" : "C"}`);
  const hasValidConIds =
    !!newShortQuote && newShortQuote.conId > 0 &&
    !!newLongQuote && newLongQuote.conId > 0;
  const inputsValid =
    !!targetExpiration &&
    quantity > 0 && quantity <= spread.quantity &&
    newShortStrike > 0 && newLongStrike > 0 &&
    closeLimit > 0 && openLimit > 0 &&
    // Calls: short < long; Puts: short > long.
    (isPut ? newShortStrike > newLongStrike : newShortStrike < newLongStrike);

  const handlePlaceOrders = async () => {
    if (!hasValidConIds || !inputsValid || !targetExpiration) return;
    setSubmitting(true);
    setError(null);
    setWarning(null);

    // Step 1: Close current spread.
    try {
      await api.ironCondor.closeSpread({
        symbol: spread.symbol,
        legs: buildCloseLegs(spread),
        quantity,
        limitPrice: closeLimit,
      });
    } catch (err) {
      setError(`Close order failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      setSubmitting(false);
      return;
    }

    // Step 2: Open new spread. The IBKR combo limit convention is negative=credit,
    // so we negate the user-entered open credit.
    try {
      await api.ironCondor.placeOrder({
        symbol: spread.symbol,
        legs: buildOpenLegs(
          newShortStrike,
          newLongStrike,
          newShortQuote!.conId,
          newLongQuote!.conId,
          isPut ? "P" : "C",
          targetExpiration,
        ),
        quantity,
        limitPrice: -openLimit,
      });
    } catch (err) {
      setWarning(
        `Close order placed, but new spread submission failed: ${err instanceof Error ? err.message : "Unknown error"}. Check open orders and place the new spread manually.`,
      );
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      onOpenChange(false);
      onSuccess();
    }, 1500);
  };

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
              {connected && wingWidth > 0 && Math.abs(newLongStrike - newShortStrike) !== wingWidth && (
                <span className="text-[10px] text-amber-600">
                  wing snapped: {wingWidth} → {Math.abs(newLongStrike - newShortStrike)}
                </span>
              )}
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

          {/* Live new-spread quotes */}
          {connected && newShortStrike > 0 && newLongStrike > 0 && (
            <div className="border-2 border-blue-200 bg-blue-50/50 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-blue-100/60 border-b border-blue-200">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                  New Spread (target {targetExpiration?.slice(4, 6)}/{targetExpiration?.slice(6, 8)})
                </span>
              </div>
              <div className="divide-y divide-blue-100">
                <LegQuoteRow side="SELL" strike={newShortStrike} right={isPut ? "P" : "C"} quote={newQuotes.get(`${newShortStrike}:${isPut ? "P" : "C"}`)} />
                <LegQuoteRow side="BUY" strike={newLongStrike} right={isPut ? "P" : "C"} quote={newQuotes.get(`${newLongStrike}:${isPut ? "P" : "C"}`)} />
              </div>
            </div>
          )}

          {/* Roll economics */}
          {connected && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Close spread cost (mid)</span>
                <span className="font-mono text-red-600">
                  −${economics.closeDebitMid.toFixed(2)}/ct
                  <span className="text-xs text-muted-foreground ml-2">
                    (${(economics.closeDebitMid * 100 * quantity).toFixed(2)} for {quantity})
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">New spread credit (mid)</span>
                <span className="font-mono text-green-600">
                  +${economics.openCreditMid.toFixed(2)}/ct
                  <span className="text-xs text-muted-foreground ml-2">
                    (${(economics.openCreditMid * 100 * quantity).toFixed(2)} for {quantity})
                  </span>
                </span>
              </div>
              <div className="border-t pt-1 flex justify-between font-semibold">
                <span>Net roll {economics.netDebitMid >= 0 ? "debit" : "credit"} (mid)</span>
                <span className={`font-mono ${economics.netDebitMid >= 0 ? "text-red-600" : "text-green-600"}`}>
                  {economics.netDebitMid >= 0 ? "−" : "+"}${Math.abs(economics.netDebitMid).toFixed(2)}/ct
                  <span className="text-xs text-muted-foreground ml-2">
                    (${(Math.abs(economics.netDebitMid) * 100 * quantity).toFixed(2)} total)
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Per-order limits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Close limit (debit, per contract)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  value={closeLimit}
                  onChange={(e) => setCloseLimit(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-28 text-center tabular-nums"
                />
                <button
                  onClick={() => setCloseLimit(Math.round(economics.closeDebitMid * 100) / 100)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  snap to mid
                </button>
              </div>
              {seedCloseDebit === 0 && (
                <span className="text-[10px] text-amber-600">
                  No mid price available from positions — enter manually
                </span>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Open limit (credit, per contract)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  value={openLimit}
                  onChange={(e) => setOpenLimit(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-28 text-center tabular-nums"
                />
                <button
                  onClick={() => setOpenLimit(Math.round(economics.openCreditMid * 100) / 100)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  snap to mid
                </button>
              </div>
            </div>
          </div>

          {/* Before/after summary */}
          {connected && newShortStrike > 0 && (
            <div className="rounded-lg border px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Before / After
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Max loss</div>
                  <div className="font-mono">
                    <span className="text-red-600">{fmtCurrency(beforeSummary.maxLoss)}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="text-red-600">{fmtCurrency(afterSummary.maxLoss)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Max profit</div>
                  <div className="font-mono">
                    <span className="text-green-600">{fmtCurrency(beforeSummary.maxProfit)}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="text-green-600">{fmtCurrency(afterSummary.maxProfit)}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Breakeven</div>
                  <div className="font-mono">
                    <span>{beforeSummary.breakeven.toFixed(2)}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span>{afterSummary.breakeven.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {warning && (
            <Alert>
              <AlertDescription className="text-amber-700">{warning}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert>
              <AlertDescription className="text-green-600">Roll orders submitted!</AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <div className="flex justify-between items-center pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <div className="flex flex-col items-end gap-1">
              {!hasValidConIds && connected && (
                <span className="text-xs text-destructive">Quotes still loading — wait for chain</span>
              )}
              {!inputsValid && hasValidConIds && (
                <span className="text-xs text-destructive">
                  {isPut
                    ? "New short must be > new long"
                    : "New short must be < new long"} — check inputs
                </span>
              )}
              <Button
                onClick={handlePlaceOrders}
                disabled={submitting || success || !hasValidConIds || !inputsValid}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {submitting ? "Placing..." : "Place Roll Orders"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
