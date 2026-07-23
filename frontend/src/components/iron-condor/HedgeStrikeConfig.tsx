/**
 * Hedge Wizard Step 2: Strike Configuration
 * Lets the user configure the hedge strike(s) with live-updating quotes from the SSE stream.
 */

import { GitBranch, Shield, ArrowDownUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActiveSpread } from "@assup/shared";
import type { HedgeStrategy } from "@assup/shared";
import { spreadModeLabel } from "./utils";

interface StrikeQuote {
  strike: number;
  right: "P" | "C";
  conId: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
}

interface HedgeStrikeConfigProps {
  spread: ActiveSpread;
  strategy: HedgeStrategy;
  availableStrikes: number[];
  quotes: Map<string, StrikeQuote>;
  selectedStrike: number;
  onSelectedStrikeChange: (strike: number) => void;
  limitPrice: number;
  onLimitPriceChange: (price: number) => void;
  hedgeMidPrice: number;
  onBack: () => void;
  onNext: () => void;
  connected: boolean;
}

function fmt(v: number | null): string {
  if (v == null) return "\u2014";
  return v.toFixed(2);
}

function strikeSummary(spread: ActiveSpread): string {
  const strikes = spread.legs.map((l) => l.strike).sort((a, b) => a - b);
  return strikes.join(" / ");
}

function formatExpiry(expiry: string): string {
  if (expiry.length !== 8) return expiry;
  const d = new Date(
    parseInt(expiry.slice(0, 4)),
    parseInt(expiry.slice(4, 6)) - 1,
    parseInt(expiry.slice(6, 8))
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dte = Math.floor(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
}

interface LegRowProps {
  side: "BUY" | "SELL";
  strike: number | null;
  right: "P" | "C";
  quote: StrikeQuote | undefined;
  strikeNode?: React.ReactNode;
}

function LegRow({ side, strike, right, quote, strikeNode }: LegRowProps) {
  const isSell = side === "SELL";
  const rightLabel = right === "P" ? "PUT" : "CALL";

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 items-center py-2 px-3 text-sm">
      {/* Side badge */}
      <Badge variant={isSell ? "danger" : "success"}>{side}</Badge>

      {/* Strike + right label */}
      <div className="flex items-center gap-2">
        {strikeNode ?? (
          <span className="font-mono font-medium">{strike ?? "\u2014"}</span>
        )}
        <span className="text-muted-foreground text-xs">{rightLabel}</span>
      </div>

      {/* Bid */}
      <div className="text-right tabular-nums">
        <span className="text-[10px] text-muted-foreground mr-1">bid</span>
        <span>{fmt(quote?.bid ?? null)}</span>
      </div>

      {/* Ask */}
      <div className="text-right tabular-nums">
        <span className="text-[10px] text-muted-foreground mr-1">ask</span>
        <span>{fmt(quote?.ask ?? null)}</span>
      </div>

      {/* Delta */}
      <div className="text-right tabular-nums w-14">
        <span className="text-[10px] text-muted-foreground mr-1">&delta;</span>
        <span>{fmt(quote?.delta ?? null)}</span>
      </div>
    </div>
  );
}

export function HedgeStrikeConfig({
  spread,
  strategy,
  availableStrikes,
  quotes,
  selectedStrike,
  onSelectedStrikeChange,
  limitPrice,
  onLimitPriceChange,
  hedgeMidPrice,
  onBack,
  onNext,
  connected,
}: HedgeStrikeConfigProps) {
  const isPut = spread.legs.some((l) => l.right === "P");
  const right: "P" | "C" = isPut ? "P" : "C";

  // Derive long leg
  const sortedLegs = [...spread.legs].sort((a, b) => a.strike - b.strike);
  const longLeg = sortedLegs.find((l) => l.side === "BUY") ?? sortedLegs[0];

  // For butterfly: middle strike is always longLeg.strike (the existing long)
  const middleStrike = longLeg?.strike ?? 0;

  const totalCost = limitPrice * 100 * spread.quantity;

  const strategyLabel =
    strategy === "butterfly" ? "Convert to Butterfly"
    : strategy === "roll" ? (isPut ? "Roll Down" : "Roll Up")
    : "Buy Protective Option";
  const StrategyIcon = strategy === "butterfly" ? GitBranch : strategy === "roll" ? ArrowDownUp : Shield;

  return (
    <div className="space-y-4">
      {/* 1. Context bar */}
      <div className="rounded-lg bg-muted/40 border px-4 py-3 flex items-center gap-3 flex-wrap">
        <StrategyIcon className="h-4 w-4 text-blue-600 shrink-0" />
        <span className="text-sm font-medium text-blue-700">{strategyLabel}</span>
        <span className="text-muted-foreground text-sm">|</span>
        <Badge
          variant={
            spread.type === "put-spread"
              ? "danger"
              : spread.type === "call-spread"
              ? "success"
              : "purple"
          }
        >
          {spreadModeLabel(spread.type)}
        </Badge>
        <span className="font-semibold text-sm">{spread.symbol}</span>
        <span className="font-mono text-sm text-muted-foreground">
          {strikeSummary(spread)}
        </span>
        <span className="text-sm text-muted-foreground">
          {formatExpiry(spread.expiry)}
        </span>
        <span className="text-sm text-muted-foreground">
          &times;{spread.quantity}
        </span>
        <div className="ml-auto">
          <button
            onClick={onBack}
            className="text-sm text-blue-600 hover:underline focus:outline-none"
          >
            &larr; Change strategy
          </button>
        </div>
      </div>

      {/* 2. Connection indicator */}
      <div className="flex items-center gap-2 px-1">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-green-500" : "bg-yellow-400"
          }`}
        />
        <span className="text-xs text-muted-foreground">
          {connected ? "Live quotes" : "Connecting..."}
        </span>
      </div>

      {/* 3. Existing legs section (read-only) */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Existing Position
          </span>
        </div>
        <div className="divide-y">
          {spread.legs.map((leg) => {
            const quoteKey = `${leg.strike}:${leg.right}`;
            return (
              <LegRow
                key={leg.conId}
                side={leg.side}
                strike={leg.strike}
                right={leg.right}
                quote={quotes.get(quoteKey)}
              />
            );
          })}
        </div>
      </div>

      {/* 4. New legs section (editable, blue highlighted) */}
      <div className="border-2 border-blue-200 bg-blue-50/50 rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-blue-100/60 border-b border-blue-200">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
            New Legs
          </span>
        </div>
        <div className="divide-y divide-blue-100">
          {strategy === "butterfly" && (
            <>
              {/* Middle leg: fixed (longLeg.strike) */}
              <LegRow
                side="BUY"
                strike={middleStrike}
                right={right}
                quote={quotes.get(`${middleStrike}:${right}`)}
              />
              {/* Outer wing: user-selectable */}
              <LegRow
                side="SELL"
                strike={selectedStrike}
                right={right}
                quote={quotes.get(`${selectedStrike}:${right}`)}
                strikeNode={
                  <Select
                    value={String(selectedStrike)}
                    onValueChange={(v) => onSelectedStrikeChange(Number(v))}
                  >
                    <SelectTrigger size="sm" className="w-28 font-mono">
                      <SelectValue placeholder="Strike" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableStrikes.map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </>
          )}

          {strategy === "protective" && (
            /* Single protective leg: user-selectable */
            <LegRow
              side="BUY"
              strike={selectedStrike}
              right={right}
              quote={quotes.get(`${selectedStrike}:${right}`)}
              strikeNode={
                <Select
                  value={String(selectedStrike)}
                  onValueChange={(v) => onSelectedStrikeChange(Number(v))}
                >
                  <SelectTrigger size="sm" className="w-28 font-mono">
                    <SelectValue placeholder="Strike" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStrikes.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          )}

          {strategy === "roll" && (
            <>
              {/* Close current short leg */}
              {spread.legs
                .filter((l) => l.side === "SELL")
                .map((leg) => (
                  <LegRow
                    key={`close-${leg.conId}`}
                    side="BUY"
                    strike={leg.strike}
                    right={leg.right}
                    quote={quotes.get(`${leg.strike}:${leg.right}`)}
                  />
                ))}
              {/* New short leg: user-selectable */}
              <LegRow
                side="SELL"
                strike={selectedStrike}
                right={right}
                quote={quotes.get(`${selectedStrike}:${right}`)}
                strikeNode={
                  <Select
                    value={String(selectedStrike)}
                    onValueChange={(v) => onSelectedStrikeChange(Number(v))}
                  >
                    <SelectTrigger size="sm" className="w-28 font-mono">
                      <SelectValue placeholder="Strike" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableStrikes.map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </>
          )}
        </div>
      </div>

      {/* 5. Cost summary bar */}
      <div className="rounded-lg bg-muted/40 border px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {strategy === "roll" ? "Net roll cost:" : "Estimated debit:"}
          </span>
          <span className="font-semibold text-red-600">
            ${totalCost.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          <span className="text-xs text-muted-foreground">
            (mid: {fmt(hedgeMidPrice)})
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm text-muted-foreground">Limit:</span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() =>
              onLimitPriceChange(
                Math.max(0, Math.round((limitPrice - 0.05) * 100) / 100)
              )
            }
            aria-label="Decrease limit price"
          >
            &minus;
          </Button>
          <Input
            type="number"
            step="0.05"
            min="0"
            value={limitPrice}
            onChange={(e) =>
              onLimitPriceChange(parseFloat(e.target.value) || 0)
            }
            className="w-24 text-center tabular-nums"
          />
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() =>
              onLimitPriceChange(
                Math.round((limitPrice + 0.05) * 100) / 100
              )
            }
            aria-label="Increase limit price"
          >
            &#43;
          </Button>
          <button
            onClick={() => onLimitPriceChange(hedgeMidPrice)}
            className="text-sm text-blue-600 hover:underline focus:outline-none whitespace-nowrap"
          >
            Snap to mid
          </button>
        </div>
      </div>

      {/* 6. Footer */}
      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={onNext}>Review Payoff &rarr;</Button>
      </div>
    </div>
  );
}
