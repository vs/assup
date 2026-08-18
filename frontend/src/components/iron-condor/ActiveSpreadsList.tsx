/**
 * Active spreads list: shows current spread/condor positions with P&L.
 * Collapsible section with expandable per-leg breakdown.
 */

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, AlertTriangle, ArrowDownUp, GitBranch, Shield, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActiveSpread, ActiveSpreadLeg } from "@assup/shared";
import type { HedgeStrategy } from "@assup/shared";
import { spreadModeLabel } from "./utils";
import type { RiskLevel, SpreadRiskStatus } from "@/hooks/useSpreadRiskStatus";
import type { HedgeRecommendation } from "@/utils/hedgeRecommendation";

interface ActiveSpreadsListProps {
  spreads: ActiveSpread[];
  onClose: (spread: ActiveSpread) => void;
  onHedge: (spread: ActiveSpread, initialStrategy?: HedgeStrategy) => void;
  riskMap: Map<string, SpreadRiskStatus>;
  recommendations: Map<string, HedgeRecommendation>;
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

/** Extract a single-side spread from an iron condor for hedging */
function extractSideSpread(spread: ActiveSpread, side: "put" | "call"): ActiveSpread {
  const right = side === "put" ? "P" : "C";
  const legs = spread.legs.filter(l => l.right === right);
  const totalPnl = legs.every(l => l.unrealizedPnl != null)
    ? legs.reduce((sum, l) => sum + (l.unrealizedPnl ?? 0), 0)
    : null;
  const netPremium = legs.reduce((sum, l) => sum + l.avgCost * l.position, 0);
  const closeMidPrice = legs.every(l => l.midPrice != null)
    ? legs.reduce((sum, l) => sum + (l.midPrice ?? 0), 0)
    : null;
  return {
    ...spread,
    id: `${spread.id}-${side}`,
    type: side === "put" ? "put-spread" : "call-spread",
    legs,
    totalPnl: totalPnl != null ? Math.round(totalPnl * 100) / 100 : null,
    netPremium: Math.round(netPremium * 100) / 100,
    closeMidPrice,
    orphanLegs: [],
  };
}

function SpreadCard({ spread, onClose, onHedge, risk, recommendation }: {
  spread: ActiveSpread;
  onClose: () => void;
  onHedge: (spread: ActiveSpread, initialStrategy?: HedgeStrategy) => void;
  risk: SpreadRiskStatus;
  recommendation?: HedgeRecommendation;
}) {
  const [expanded, setExpanded] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);

  // Auto-expand when recommendation urgency is warning or critical
  const shouldAutoExpand = recommendation != null &&
    recommendation.action !== "hold" &&
    (recommendation.urgency === "warning" || recommendation.urgency === "critical");

  if (shouldAutoExpand && !autoExpanded) {
    setExpanded(true);
    setAutoExpanded(true);
  }
  if (!shouldAutoExpand && autoExpanded) {
    setAutoExpanded(false);
  }

  const isDanger = risk.level === "danger";
  const isWarning = risk.level === "warning";
  const isIronCondor = spread.type === "iron-condor";

  const cardClass = isDanger
    ? "border rounded-lg bg-red-50 border-red-200 border-l-[3px] border-l-red-500"
    : isWarning
    ? "border rounded-lg bg-amber-50 border-amber-200 border-l-[3px] border-l-yellow-500"
    : "border rounded-lg bg-card";

  return (
    <div className={cardClass}>
      {/* Header row — click anywhere to expand/collapse */}
      <div className="flex items-center justify-between p-3 cursor-pointer select-none" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
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
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            Close
          </Button>
        </div>
      </div>

      {/* Recommendation banner */}
      {recommendation && recommendation.action !== "hold" && (
        <div
          className={cn(
            "px-3 py-2 text-sm border-t",
            recommendation.urgency === "critical"
              ? "bg-red-100 text-red-800 border-red-200"
              : recommendation.urgency === "warning"
              ? "bg-amber-100 text-amber-800 border-amber-200"
              : "bg-muted/50 text-muted-foreground",
          )}
          title={recommendation.details}
        >
          {recommendation.reason}
        </div>
      )}

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

          {isIronCondor ? (
            <div className="flex justify-end pt-2 border-t mt-2">
              <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-1.5 gap-y-1 items-center">
                <span className="text-[10px] font-semibold text-red-600 pr-1">PUT</span>
                <Button variant="outline" size="sm" onClick={() => onHedge(extractSideSpread(spread, "put"), "roll")} className="gap-1 text-xs h-7 px-2">
                  <ArrowDownUp className="h-3 w-3" /> Roll Down
                </Button>
                <Button variant="outline" size="sm" onClick={() => onHedge(extractSideSpread(spread, "put"), "butterfly")} className="gap-1 text-xs h-7 px-2">
                  <GitBranch className="h-3 w-3" /> Butterfly
                </Button>
                <Button variant="outline" size="sm" onClick={() => onHedge(extractSideSpread(spread, "put"), "protective")} className="gap-1 text-xs h-7 px-2">
                  <Shield className="h-3 w-3" /> Protective
                </Button>
                <span className="text-[10px] font-semibold text-green-600 pr-1">CALL</span>
                <Button variant="outline" size="sm" onClick={() => onHedge(extractSideSpread(spread, "call"), "roll")} className="gap-1 text-xs h-7 px-2">
                  <ArrowDownUp className="h-3 w-3" /> Roll Up
                </Button>
                <Button variant="outline" size="sm" onClick={() => onHedge(extractSideSpread(spread, "call"), "butterfly")} className="gap-1 text-xs h-7 px-2">
                  <GitBranch className="h-3 w-3" /> Butterfly
                </Button>
                <Button variant="outline" size="sm" onClick={() => onHedge(extractSideSpread(spread, "call"), "protective")} className="gap-1 text-xs h-7 px-2">
                  <Shield className="h-3 w-3" /> Protective
                </Button>
                <div />
                <div />
                <div />
                <Button variant="outline" size="sm" onClick={onClose} className="gap-1 text-xs h-7 px-2 text-red-600 border-red-200 hover:bg-red-50">
                  <XIcon className="h-3 w-3" /> Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1.5 pt-2 border-t mt-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => onHedge(spread, "roll")} className="gap-1 text-xs h-7 px-2">
                <ArrowDownUp className="h-3 w-3" />
                {spread.type === "put-spread" ? "Roll Down" : "Roll Up"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onHedge(spread, "butterfly")} className="gap-1 text-xs h-7 px-2">
                <GitBranch className="h-3 w-3" /> Butterfly
              </Button>
              <Button variant="outline" size="sm" onClick={() => onHedge(spread, "protective")} className="gap-1 text-xs h-7 px-2">
                <Shield className="h-3 w-3" />
                {spread.type === "put-spread" ? "Protective Put" : "Protective Call"}
              </Button>
              <Button variant="outline" size="sm" onClick={onClose} className="gap-1 text-xs h-7 px-2 text-red-600 border-red-200 hover:bg-red-50">
                <XIcon className="h-3 w-3" /> Close
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActiveSpreadsList({ spreads, onClose, onHedge, riskMap, recommendations }: ActiveSpreadsListProps) {
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
              onHedge={onHedge}
              risk={riskMap.get(spread.id) ?? { level: "healthy", premiumMultiple: null }}
              recommendation={recommendations.get(spread.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
