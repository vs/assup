/**
 * Hedge Wizard Step 1: Strategy Picker
 * Shows context banner of the at-risk spread and two strategy cards
 * for the user to choose between butterfly conversion and protective option.
 */

import { GitBranch, Shield, Check, X, ArrowDownUp, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ActiveSpread, HedgeStrategy } from "@assup/shared";
import { spreadModeLabel } from "./utils";

export type { HedgeStrategy };

interface HedgeStrategyPickerProps {
  spread: ActiveSpread;
  premiumMultiple: number | null;
  onSelect: (strategy: HedgeStrategy) => void;
}

function formatExpiry(expiry: string): string {
  if (expiry.length !== 8) return expiry;
  const d = new Date(parseInt(expiry.slice(0, 4)), parseInt(expiry.slice(4, 6)) - 1, parseInt(expiry.slice(6, 8)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
}

function formatCurrency(value: number | null, opts?: { sign?: boolean }): string {
  if (value == null) return "\u2014";
  const abs = Math.abs(value);
  const formatted = `$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (opts?.sign) {
    return value >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return value < 0 ? `-${formatted}` : formatted;
}

function strikeSummary(spread: ActiveSpread): string {
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  return strikes.join(" / ");
}

function deriveWingWidth(spread: ActiveSpread): number {
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  if (strikes.length < 2) return 5;
  return strikes[1] - strikes[0];
}

export function HedgeStrategyPicker({ spread, premiumMultiple, onSelect }: HedgeStrategyPickerProps) {
  const isPut = spread.type === "put-spread";
  const isCall = spread.type === "call-spread";

  const wingWidth = deriveWingWidth(spread);
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);

  // For put spread: long put is lowest strike, short put is next
  // For call spread: long call is highest strike, short call is next lower
  const longLegStrike = isPut ? strikes[0] : strikes[strikes.length - 1];
  const shortLegStrike = isPut ? strikes[1] : strikes[strikes.length - 2];

  // Butterfly: add another long leg one wing width below/above the long leg
  const butterflyExtraStrike = isPut
    ? longLegStrike - wingWidth
    : longLegStrike + wingWidth;

  // Protective: buy an option one wing width below/above the long leg
  const protectiveStrike = butterflyExtraStrike;

  const protectiveLabel = isPut ? "Buy Protective Put" : "Buy Protective Call";
  const optionRight = isPut ? "PUT" : "CALL";

  const shortStrike = shortLegStrike;
  const longStrike = longLegStrike;

  return (
    <div className="space-y-4">
      {/* Context banner */}
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={isPut ? "danger" : isCall ? "success" : "purple"}>
            {spreadModeLabel(spread.type)}
          </Badge>
          <span className="font-semibold text-sm">{spread.symbol}</span>
          <span className="text-sm text-red-700 font-mono">{strikeSummary(spread)}</span>
          <span className="text-sm text-red-700">{formatExpiry(spread.expiry)}</span>
          <span className="text-sm text-red-700">&times;{spread.quantity}</span>
        </div>

        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <span className="text-xs text-red-600">P&amp;L</span>
            <span className={`ml-1.5 font-bold text-sm ${spread.totalPnl != null && spread.totalPnl < 0 ? "text-red-700" : "text-green-700"}`}>
              {formatCurrency(spread.totalPnl, { sign: true })}
              {premiumMultiple != null && premiumMultiple > 0 && (
                <span className="text-xs font-normal text-red-500 ml-1">
                  ({premiumMultiple.toFixed(1)}&times; premium)
                </span>
              )}
            </span>
          </div>
          <div>
            <span className="text-xs text-red-600">Net Premium</span>
            <span className="ml-1.5 text-sm font-medium text-red-700">
              {formatCurrency(spread.netPremium, { sign: true })}
            </span>
          </div>
        </div>

        {/* Per-leg info */}
        <div className="grid grid-cols-2 gap-2">
          {spread.legs.map(leg => (
            <div key={leg.conId} className="flex items-center gap-2 text-xs text-red-700">
              <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                leg.side === "SELL" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"
              }`}>
                {leg.side}
              </span>
              <span>{leg.right === "P" ? "PUT" : "CALL"} {leg.strike}</span>
              <span className="text-red-500">&times;{Math.abs(leg.position)}</span>
              {leg.unrealizedPnl != null && (
                <span className={leg.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"}>
                  {formatCurrency(leg.unrealizedPnl, { sign: true })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">Choose a hedging strategy:</p>

      {/* Strategy cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Butterfly card */}
        <button
          onClick={() => onSelect("butterfly")}
          className="text-left border rounded-lg p-4 space-y-3 hover:border-blue-400 hover:bg-blue-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-sm">Convert to Butterfly</span>
          </div>

          <p className="text-xs text-muted-foreground">
            Overlay a debit {optionRight} spread (BUY {longStrike} / SELL {butterflyExtraStrike}) on top of your existing {spreadModeLabel(spread.type)}, producing an inverted butterfly. Profits if price moves past either wing; max loss occurs at the long strike.
          </p>

          <pre className="text-[10px] font-mono bg-muted/60 rounded p-2 leading-relaxed whitespace-pre">
{`Before (${spreadModeLabel(spread.type)}):
  SELL ${optionRight} ${shortStrike}
  BUY  ${optionRight} ${longStrike}

After (Inverted Butterfly):
  SELL ${optionRight} ${shortStrike}  ← existing
  BUY  ${optionRight} ${longStrike}  ← existing
  BUY  ${optionRight} ${longStrike}  ← new (doubles middle)
  SELL ${optionRight} ${butterflyExtraStrike}  ← new (outer wing)`}
          </pre>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-green-700">
              <Check className="h-3 w-3 shrink-0" />
              <span>Profits if price moves past either wing</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>Max loss at the long strike — typically worse than the original spread</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <X className="h-3 w-3 shrink-0" />
              <span>Costs additional premium upfront</span>
            </div>
          </div>
        </button>

        {/* Protective option card */}
        <button
          onClick={() => onSelect("protective")}
          className="text-left border rounded-lg p-4 space-y-3 hover:border-blue-400 hover:bg-blue-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-sm">{protectiveLabel}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            Buy a standalone {optionRight} at {protectiveStrike} as a protective hedge. Provides directional protection independent of your spread.
          </p>

          <pre className="text-[10px] font-mono bg-muted/60 rounded p-2 leading-relaxed whitespace-pre">
{`Existing (unchanged):
  SELL ${optionRight} ${shortStrike}
  BUY  ${optionRight} ${longStrike}

New protective leg:
  BUY  ${optionRight} ${protectiveStrike}  ← standalone`}
          </pre>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-green-700">
              <Check className="h-3 w-3 shrink-0" />
              <span>Flexible — different expiry/strike possible</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-green-700">
              <Check className="h-3 w-3 shrink-0" />
              <span>Profits accelerate if move continues</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <X className="h-3 w-3 shrink-0" />
              <span>Theta decay on standalone option</span>
            </div>
          </div>
        </button>

        {/* Roll card */}
        <button
          onClick={() => onSelect("roll")}
          className="text-left border rounded-lg p-4 space-y-3 hover:border-blue-400 hover:bg-blue-50/50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 col-span-2"
        >
          <div className="flex items-center gap-2">
            <ArrowDownUp className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-sm">
              {isPut ? "Roll Down" : "Roll Up"}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Move your short {optionRight} from {shortStrike} further {isPut ? "down" : "up"}.
            Closes the current short leg and sells a new one at a safer strike,
            reducing risk at the cost of some credit.
          </p>

          <pre className="text-[10px] font-mono bg-muted/60 rounded p-2 leading-relaxed whitespace-pre">
{`Close (buy back):
  BUY  ${optionRight} ${shortStrike}  ← close current short

Open (new short):
  SELL ${optionRight} ${isPut ? shortStrike - wingWidth : shortStrike + wingWidth}  ← new strike`}
          </pre>

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-green-700">
              <Check className="h-3 w-3 shrink-0" />
              <span>Moves short leg away from danger zone</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-green-700">
              <Check className="h-3 w-3 shrink-0" />
              <span>Keeps spread structure intact</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <X className="h-3 w-3 shrink-0" />
              <span>Costs debit to roll (reduces net credit)</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <X className="h-3 w-3 shrink-0" />
              <span>Worse if crash continues through new strike</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
