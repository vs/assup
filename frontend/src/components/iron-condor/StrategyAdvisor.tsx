/**
 * Strategy Advisor panel for the spreads builder.
 *
 * Fetches VIX-based strategy metrics from the backend and displays:
 *  - Market data (VIX, VIX3M, HV10, IV/HV ratio)
 *  - Entry filter status (pass/fail with reasons)
 *  - Recommended strikes, wing width, position sizing
 *  - Apply button to feed recommendations into the OptionsBuilder
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  TrendingUp,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "@/api";
import type { SpreadStrategyMetrics, StrategyFilter } from "@assup/shared";

function formatStaleAge(minutes: number | null): string {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export interface StrategyApplyParams {
  shortStrike: number;
  longStrike: number;
  wingWidth: number;
  quantity: number;
  baseQuantity: number;
}

interface StrategyAdvisorProps {
  symbol: string;
  baseQuantity: number;
  onApply: (params: StrategyApplyParams) => void;
}

function FilterBadge({ filter }: { filter: StrategyFilter }) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm",
      filter.passed
        ? "bg-green-50 border-green-200 text-green-800"
        : "bg-red-50 border-red-200 text-red-800",
    )}>
      {filter.passed
        ? <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
        : <ShieldX className="h-4 w-4 text-red-600 shrink-0" />}
      <div className="min-w-0">
        <div className="font-medium">{filter.name}</div>
        <div className="text-xs opacity-80 leading-tight">{filter.reason}</div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, color }: {
  label: string;
  value: string | number | null;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="text-center px-2">
      <div className={cn("text-lg font-bold tabular-nums", color ?? "text-foreground")}>
        {value ?? "--"}{unit && <span className="text-xs font-normal ml-0.5">{unit}</span>}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

export function StrategyAdvisor({ symbol, baseQuantity, onApply }: StrategyAdvisorProps) {
  const [metrics, setMetrics] = useState<SpreadStrategyMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.ironCondor.getSpreadStrategyMetrics(symbol);
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch strategy metrics");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Fetch on mount and when symbol changes
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const handleApply = useCallback(() => {
    if (!metrics?.recommendedShortStrike || !metrics?.recommendedLongStrike) return;
    const mult = metrics.positionMultiplier ?? 1;
    onApply({
      shortStrike: metrics.recommendedShortStrike,
      longStrike: metrics.recommendedLongStrike,
      wingWidth: metrics.wingWidth,
      quantity: Math.max(1, Math.round(baseQuantity * mult)),
      baseQuantity,
    });
  }, [metrics, baseQuantity, onApply]);

  const handleRecordLoss = useCallback(async () => {
    try {
      await api.ironCondor.recordStrategyLoss(symbol);
      fetchMetrics();
    } catch { /* ignore */ }
  }, [symbol, fetchMetrics]);

  const handleClearCooloff = useCallback(async () => {
    try {
      await api.ironCondor.clearStrategyCooloff(symbol);
      fetchMetrics();
    } catch { /* ignore */ }
  }, [symbol, fetchMetrics]);

  // Determine overall status
  const statusIcon = metrics == null
    ? null
    : metrics.allFiltersPassed
      ? <ShieldCheck className="h-4 w-4 text-green-600" />
      : metrics.filters.some(f => !f.passed)
        ? <ShieldAlert className="h-4 w-4 text-amber-600" />
        : null;

  const statusText = metrics == null
    ? "Loading..."
    : metrics.allFiltersPassed
      ? "All filters passed — trade entry recommended"
      : `${metrics.filters.filter(f => !f.passed).length} filter(s) failed — skip today`;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <Zap className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-sm font-semibold flex-1">Strategy Advisor</span>

        {metrics && !loading && (
          <span className="flex items-center gap-1.5 text-xs">
            {statusIcon}
            <span className={cn(
              metrics.allFiltersPassed ? "text-green-700" : "text-amber-700",
            )}>
              {statusText}
            </span>
          </span>
        )}

        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 py-3 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {metrics && (
            <>
              {/* Market data row */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-4">
                  <MetricCard
                    label={symbol}
                    value={metrics.underlyingPrice?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? null}
                  />
                  <MetricCard
                    label="VIX"
                    value={metrics.spotVix?.toFixed(1) ?? null}
                    color={metrics.spotVix != null && metrics.spotVix > 25 ? "text-red-600" : undefined}
                  />
                  <div className="relative">
                    <MetricCard
                      label="VIX3M"
                      value={metrics.vix3m?.toFixed(1) ?? null}
                    />
                    {metrics.vix3mSource === "cached" && (
                      <div
                        className="absolute -top-1 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 leading-none whitespace-nowrap"
                        title={`Live VIX3M unavailable — showing cached value from ${formatStaleAge(metrics.vix3mAgeMinutes)} ago`}
                      >
                        cached · {formatStaleAge(metrics.vix3mAgeMinutes)}
                      </div>
                    )}
                  </div>
                  <MetricCard
                    label="HV10"
                    value={metrics.hv10?.toFixed(1) ?? null}
                  />
                  <MetricCard
                    label="IV/HV"
                    value={metrics.ivHvRatio?.toFixed(2) ?? null}
                    color={
                      metrics.ivHvRatio != null
                        ? metrics.ivHvRatio >= 1.2 ? "text-green-600"
                        : metrics.ivHvRatio < 0.8 ? "text-red-600"
                        : undefined
                        : undefined
                    }
                  />
                </div>

                <Button variant="ghost" size="sm" onClick={fetchMetrics} disabled={loading}>
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                </Button>
              </div>

              {/* Filters */}
              <div className="space-y-1.5">
                {metrics.filters.map((filter) => (
                  <FilterBadge key={filter.name} filter={filter} />
                ))}
              </div>

              {/* Cooloff controls */}
              {(metrics.cooloffActive || metrics.lastLossDate) && (
                <div className="flex items-center gap-2 text-xs">
                  {metrics.cooloffActive && (
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={handleClearCooloff}>
                      Clear Cooloff
                    </Button>
                  )}
                  {!metrics.cooloffActive && (
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={handleRecordLoss}>
                      Record Loss
                    </Button>
                  )}
                </div>
              )}
              {!metrics.cooloffActive && !metrics.lastLossDate && (
                <div className="flex items-center gap-2 text-xs">
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={handleRecordLoss}>
                    Record Loss
                  </Button>
                </div>
              )}

              {/* Recommendation */}
              {metrics.recommendedShortStrike != null && metrics.recommendedLongStrike != null && (
                <div className={cn(
                  "border rounded-lg p-4",
                  metrics.allFiltersPassed
                    ? "bg-blue-50 border-blue-200"
                    : "bg-muted/30 border-border",
                )}>
                  <div className="flex items-start gap-3">
                    <TrendingUp className={cn(
                      "h-5 w-5 mt-0.5 shrink-0",
                      metrics.allFiltersPassed ? "text-blue-600" : "text-muted-foreground",
                    )} />
                    <div className="flex-1 space-y-2">
                      <div className="text-sm font-semibold">
                        {metrics.allFiltersPassed ? "Recommended Entry" : "Computed Levels (filters not passing)"}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">Short Strike</div>
                          <div className="font-bold tabular-nums">{metrics.recommendedShortStrike}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">Long Strike</div>
                          <div className="font-bold tabular-nums">{metrics.recommendedLongStrike}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">Wing Width</div>
                          <div className="font-bold tabular-nums">{metrics.wingWidth} pts</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase">Size Mult</div>
                          <div className="font-bold tabular-nums">{metrics.positionMultiplier?.toFixed(2) ?? "--"}x</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Daily 1-SD move: {metrics.dailyMovePct?.toFixed(2)}% |
                        {" "}{metrics.recommendedExpiry ?? "Weekend"} |
                        {" "}Qty: {Math.max(1, Math.round(baseQuantity * (metrics.positionMultiplier ?? 1)))} ({baseQuantity} base x {metrics.positionMultiplier?.toFixed(2) ?? "1"}x)
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      onClick={handleApply}
                      disabled={!metrics.allFiltersPassed}
                      className="gap-1.5"
                    >
                      Apply to Builder
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
