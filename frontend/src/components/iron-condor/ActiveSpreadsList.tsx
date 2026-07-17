/**
 * Active spreads list: shows current spread/condor positions with P&L.
 * Collapsible section with expandable per-leg breakdown.
 */

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ActiveSpread, ActiveSpreadLeg } from "@assup/shared";
import { spreadModeLabel } from "./utils";
import type { RiskLevel, SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";

interface ActiveSpreadsListProps {
  spreads: ActiveSpread[];
  onClose: (spread: ActiveSpread) => void;
  onHedge: (spread: ActiveSpread) => void;
  riskMap: Map<string, SpreadRiskStatus>;
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

function SpreadCard({ spread, onClose, onHedge, risk }: { spread: ActiveSpread; onClose: () => void; onHedge: () => void; risk: SpreadRiskStatus }) {
  const [expanded, setExpanded] = useState(false);

  const isDanger = risk.level === "danger";
  const isWarning = risk.level === "warning";
  const isAtRisk = isDanger || isWarning;

  const cardClass = isDanger
    ? "border rounded-lg bg-red-50 border-red-200 border-l-[3px] border-l-red-500"
    : isWarning
    ? "border rounded-lg bg-amber-50 border-amber-200 border-l-[3px] border-l-yellow-500"
    : "border rounded-lg bg-card";

  return (
    <div className={cardClass}>
      {/* Header row */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <Badge variant={spread.type === "put-spread" ? "danger" : spread.type === "call-spread" ? "success" : "purple"}>
            {spreadModeLabel(spread.type)}
          </Badge>
          <span className="font-semibold">{strikeSummary(spread)}</span>
          <span className="text-sm text-muted-foreground">{formatExpiry(spread.expiry)}</span>
          <span className="text-sm text-muted-foreground">{"\u00D7"}{spread.quantity}</span>
          {isDanger && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-red-100 text-red-800 border border-red-200">
              <AlertTriangle className="h-3 w-3" /> DANGER
            </span>
          )}
          {isWarning && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">
              <AlertTriangle className="h-3 w-3" /> WARNING
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">P&L</div>
            <div className={`font-bold ${pnlColor(spread.totalPnl)}`}>
              {formatCurrency(spread.totalPnl, { sign: true })}
              {risk.premiumMultiple != null && risk.premiumMultiple > 0 && (
                <span className="text-xs text-muted-foreground font-normal ml-1">({risk.premiumMultiple.toFixed(1)}{"\u00D7"} premium)</span>
              )}
            </div>
          </div>
          {isAtRisk && (
            <Button
              variant="outline"
              size="sm"
              onClick={onHedge}
              className={isDanger
                ? "bg-red-50 text-red-800 border-red-300 hover:bg-red-100"
                : "bg-yellow-50 text-yellow-800 border-yellow-300 hover:bg-yellow-100"}
            >
              Hedge
            </Button>
          )}
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

          {!isAtRisk && (
            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={onHedge} className="text-muted-foreground w-full justify-start">
                Hedge this spread...
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActiveSpreadsList({ spreads, onClose, onHedge, riskMap }: ActiveSpreadsListProps) {
  const [collapsed, setCollapsed] = useState(false);

  const count = spreads.length;

  const sortedSpreads = useMemo(() => {
    const levelOrder: Record<RiskLevel, number> = { danger: 0, warning: 1, healthy: 2 };
    return [...spreads].sort((a, b) => {
      const aLevel = riskMap.get(a.id)?.level ?? "healthy";
      const bLevel = riskMap.get(b.id)?.level ?? "healthy";
      return levelOrder[aLevel] - levelOrder[bLevel];
    });
  }, [spreads, riskMap]);

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
          {count === 0 && (
            <div className="text-sm text-muted-foreground py-2 px-1">No active spread positions</div>
          )}

          {sortedSpreads.map(spread => (
            <SpreadCard
              key={spread.id}
              spread={spread}
              onClose={() => onClose(spread)}
              onHedge={() => onHedge(spread)}
              risk={riskMap.get(spread.id) ?? { level: "healthy", premiumMultiple: null }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
