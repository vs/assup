/**
 * Active spreads list: shows current spread/condor positions with P&L.
 * Collapsible section with expandable per-leg breakdown.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ActiveSpread, ActiveSpreadLeg } from "@assup/shared";
import { spreadModeLabel } from "./utils";

interface ActiveSpreadsListProps {
  spreads: ActiveSpread[];
  symbol: string;
  onClose: (spread: ActiveSpread) => void;
}

function formatExpiry(expiry: string): string {
  if (expiry.length !== 8) return expiry;
  const d = new Date(parseInt(expiry.slice(0, 4)), parseInt(expiry.slice(4, 6)) - 1, parseInt(expiry.slice(6, 8)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dte = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${dte} DTE)`;
}

function strikeSummary(spread: ActiveSpread): string {
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  return strikes.join(" / ");
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

function pnlColor(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  return value >= 0 ? "text-green-600" : "text-red-600";
}

function LegRow({ leg }: { leg: ActiveSpreadLeg }) {
  const isSell = leg.side === "SELL";
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center py-1.5 px-2 rounded text-sm ${isSell ? "bg-muted/50" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
          isSell ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"
        }`}>
          {leg.side}
        </span>
        <span className="font-medium">{leg.right === "P" ? "PUT" : "CALL"} {leg.strike}</span>
        <span className="text-muted-foreground text-xs">{"\u00D7"}{Math.abs(leg.position)}</span>
      </div>
      <div className="text-right text-muted-foreground">
        <span className="text-xs">Cost </span>
        <span>{formatCurrency(leg.avgCost)}</span>
      </div>
      <div className="text-right text-muted-foreground">
        <span className="text-xs">Market Value </span>
        <span>{formatCurrency(leg.marketValue)}</span>
      </div>
      <div className={`text-right font-semibold ${pnlColor(leg.unrealizedPnl)}`}>
        {formatCurrency(leg.unrealizedPnl, { sign: true })}
      </div>
    </div>
  );
}

function SpreadCard({ spread, onClose }: { spread: ActiveSpread; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg bg-card">
      {/* Header row */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
            spread.type === "put-spread" ? "bg-amber-100 text-amber-800"
            : spread.type === "call-spread" ? "bg-blue-100 text-blue-700"
            : "bg-violet-100 text-violet-700"
          }`}>
            {spreadModeLabel(spread.type)}
          </span>
          <span className="font-semibold">{strikeSummary(spread)}</span>
          <span className="text-sm text-muted-foreground">{formatExpiry(spread.expiry)}</span>
          <span className="text-sm text-muted-foreground">{"\u00D7"}{spread.quantity}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">P&L</div>
            <div className={`font-bold ${pnlColor(spread.totalPnl)}`}>
              {formatCurrency(spread.totalPnl, { sign: true })}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t px-3 py-2 space-y-1">
          {spread.legs.map(leg => (
            <LegRow key={leg.conId} leg={leg} />
          ))}

          {/* Summary row */}
          <div className="border-t mt-2 pt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm px-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net Premium Received:</span>
              <span className={`font-medium ${spread.netPremium >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(spread.netPremium, { sign: true })}
              </span>
            </div>
            {spread.closeMidPrice != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Close Price (mid):</span>
                <span className="font-medium">{formatCurrency(spread.closeMidPrice)}/contract</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ActiveSpreadsList({ spreads, symbol, onClose }: ActiveSpreadsListProps) {
  const [collapsed, setCollapsed] = useState(false);

  const filtered = spreads.filter(s => s.symbol === symbol);
  const matchedSpreads = filtered.filter(s => s.legs.length > 0);
  const orphanEntries = filtered.filter(s => s.orphanLegs.length > 0);
  const allOrphans = orphanEntries.flatMap(s => s.orphanLegs);

  const count = matchedSpreads.length;

  if (count === 0 && allOrphans.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-lg p-3 bg-muted/20">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span className="text-sm font-semibold">Active Spreads</span>
        {count > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
            {count}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2">
          {matchedSpreads.map(spread => (
            <SpreadCard key={spread.id} spread={spread} onClose={() => onClose(spread)} />
          ))}

          {allOrphans.length > 0 && (
            <div className="border rounded-lg p-3 bg-amber-50 border-amber-200">
              <div className="flex items-center gap-2 text-xs text-amber-700 font-semibold mb-2">
                <AlertTriangle className="h-3.5 w-3.5" />
                Unmatched Legs
              </div>
              <div className="space-y-1">
                {allOrphans.map(leg => (
                  <LegRow key={leg.conId} leg={leg} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
