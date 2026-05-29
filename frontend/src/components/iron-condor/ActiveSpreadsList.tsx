/**
 * Active spreads list: shows current spread/condor positions with P&L.
 * Collapsible section with expandable per-leg breakdown.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ActiveSpread, ActiveSpreadLeg, SpreadMode } from "@assup/shared";

interface ActiveSpreadsListProps {
  spreads: ActiveSpread[];
  symbol: string;
  onClose: (spread: ActiveSpread) => void;
}

function spreadModeLabel(mode: SpreadMode): string {
  switch (mode) {
    case "put-spread": return "Put Spread";
    case "call-spread": return "Call Spread";
    case "iron-condor": return "Iron Condor";
  }
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
  return strikes.join("/");
}

function formatPnl(pnl: number | null): { text: string; color: string } {
  if (pnl == null) return { text: "\u2014", color: "text-muted-foreground" };
  const sign = pnl >= 0 ? "+" : "";
  return {
    text: `${sign}$${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    color: pnl >= 0 ? "text-green-600" : "text-red-600",
  };
}

function LegRow({ leg }: { leg: ActiveSpreadLeg }) {
  const pnl = formatPnl(leg.unrealizedPnl);
  return (
    <div className="flex items-center justify-between py-1 px-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
          leg.side === "SELL"
            ? (leg.right === "P" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")
            : (leg.right === "P" ? "bg-red-50 text-red-500" : "bg-green-50 text-green-500")
        }`}>
          {leg.side}
        </span>
        <span>{leg.right === "P" ? "PUT" : "CALL"} {leg.strike}</span>
        <span className="text-muted-foreground">{"\u00D7"} {Math.abs(leg.position)}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">cost ${leg.avgCost.toFixed(2)}</span>
        <span className="text-muted-foreground">mkt ${leg.marketValue?.toLocaleString() ?? "\u2014"}</span>
        <span className={`font-medium ${pnl.color}`}>{pnl.text}</span>
      </div>
    </div>
  );
}

function SpreadCard({ spread, onClose }: { spread: ActiveSpread; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const pnl = formatPnl(spread.totalPnl);

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
            spread.type === "put-spread" ? "bg-red-100 text-red-700"
            : spread.type === "call-spread" ? "bg-green-100 text-green-700"
            : "bg-blue-100 text-blue-700"
          }`}>
            {spreadModeLabel(spread.type)}
          </span>
          <span className="text-sm font-semibold">{strikeSummary(spread)}</span>
          <span className="text-xs text-muted-foreground">{formatExpiry(spread.expiry)}</span>
          <span className="text-xs text-muted-foreground">{"\u00D7"} {spread.quantity}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-sm font-bold ${pnl.color}`}>{pnl.text}</span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t px-3 py-2 space-y-0.5">
          {spread.legs.map(leg => (
            <LegRow key={leg.conId} leg={leg} />
          ))}
          <div className="border-t mt-1 pt-1 flex justify-between text-xs">
            <span className="text-muted-foreground">Net Premium:</span>
            <span className={spread.netPremium >= 0 ? "text-green-600" : "text-red-600"}>
              {spread.netPremium >= 0 ? "+" : ""}${spread.netPremium.toLocaleString()}
            </span>
          </div>
          {spread.closeMidPrice != null && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Close Mid Price:</span>
              <span>${spread.closeMidPrice.toFixed(2)} per contract</span>
            </div>
          )}
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
              <div className="space-y-0.5">
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
