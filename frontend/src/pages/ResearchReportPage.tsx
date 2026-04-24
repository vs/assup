import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { researchApi } from "@/api";
import type {
  ResearchReport,
  AnalysisResult,
  CollectionStatus,
  CollectionDataEntry,
} from "@assup/shared";
import { RecommendationBadge, PageLoadingSkeleton, ExternalLinks } from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ThumbsUp,
  AlertTriangle,
  ChevronDown,
  Activity,
} from "lucide-react";
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { timeAgo } from "@/utils/format";
import { useTickerProfile } from "@/hooks/useTickerProfile";
import { AreaChart, Area, YAxis, ResponsiveContainer } from "recharts";

// --- Source Icons ---

function SAIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 5h3.5l-4.5 5h3l-5 5 2-3.5H7L10.5 7z" />
    </svg>
  );
}

function RedditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

function StockTwitsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M3 3h18v13H7.5L3 20V3zm2 2v10.17L6.83 14H19V5H5z" />
      <path d="M8 8h8v1.5H8zm0 3h5v1.5H8z" />
    </svg>
  );
}

// --- Helpers ---

function getAnalysis(analyses: AnalysisResult[], source: string) {
  return analyses.find((a) => a.source === source);
}

function det(a: AnalysisResult | undefined): Record<string, unknown> {
  return (a?.details as Record<string, unknown>) ?? {};
}

function fmt(v: unknown, decimals = 2): string {
  if (v == null) return "N/A";
  if (typeof v === "number") return v.toFixed(decimals);
  return String(v);
}

function pct(v: unknown): string {
  if (v == null) return "N/A";
  if (typeof v === "number") return `${(v * 100).toFixed(1)}%`;
  return String(v);
}

function fmtCap(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}




function trendLabel(trend: string | undefined | null): string {
  if (!trend) return "N/A";
  return trend.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const diff = Math.ceil(
    (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 0) return "Today";
  return `in ${diff}d`;
}

function SignalIcon({ signal }: { signal: string }) {
  if (signal === "bullish")
    return <TrendingUp className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />;
  if (signal === "bearish")
    return <TrendingDown className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />;
  return <Minus className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />;
}

// --- Key Info Bullet ---

function InfoBullet({
  label,
  signal,
  children,
}: {
  label: string;
  signal?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/40 last:border-0">
      {signal && <SignalIcon signal={signal} />}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
          {label}
        </div>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

// --- Metric Item ---

function MetricItem({
  label,
  value,
  color,
  tip,
}: {
  label: string;
  value: string;
  color?: "green" | "red" | "amber";
  tip?: string;
}) {
  const colorClass =
    color === "green" ? "text-green-600" :
    color === "red" ? "text-red-600" :
    color === "amber" ? "text-amber-600" : "";
  const labelEl = tip ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground underline decoration-dotted cursor-help">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  ) : (
    <span className="text-muted-foreground">{label}</span>
  );
  return (
    <span>
      {labelEl}: <span className={`font-medium ${colorClass}`}>{value}</span>
    </span>
  );
}

// --- Company Info Panel ---

function CompanyInfoPanel({
  report,
  analyses,
  techD,
  socialD,
  fundD,
  optD,
}: {
  report: ResearchReport | null;
  analyses: AnalysisResult[];
  techD: Record<string, unknown>;
  socialD: Record<string, unknown>;
  fundD: Record<string, unknown>;
  optD: Record<string, unknown>;
}) {
  const technical = getAnalysis(analyses, "technical");
  const social = getAnalysis(analyses, "social");
  const fundamentalsAnalysis = getAnalysis(analyses, "fundamentals");
  const options = getAnalysis(analyses, "options");
  const events = getAnalysis(analyses, "events");
  const eventsD = det(events);

  const fund = fundD.fundamentals as {
    pe?: number | null;
    forwardPe?: number | null;
    eps?: number | null;
    epsGrowth?: number | null;
    dividendYield?: number | null;
    revenue?: number | null;
    marketCap?: number | null;
    beta?: number | null;
    roe?: number | null;
    debtToEquity?: number | null;
    profitMargin?: number | null;
    revenueGrowth?: number | null;
    bookValue?: number | null;
    priceToBook?: number | null;
    priceToCashFlow?: number | null;
  } | null;

  return (
    <Card className="lg:col-span-2">
      <CardContent className="py-3 px-4 overflow-y-auto" style={{ maxHeight: 460 }}>
        {/* Company Overview */}
        {report?.companyOverview && (
          <InfoBullet label="Company">
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1">
                {report.companyOverview.sector && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {report.companyOverview.sector}
                  </Badge>
                )}
                {report.companyOverview.industry && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {report.companyOverview.industry}
                  </Badge>
                )}
                {report.companyOverview.marketPosition && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {report.companyOverview.marketPosition}
                  </Badge>
                )}
              </div>
              {report.companyOverview.description && (
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {report.companyOverview.description}
                </p>
              )}
            </div>
          </InfoBullet>
        )}

        {/* Recommendation */}
        {report && (
          <InfoBullet label="Recommendation">
            <div className="flex items-center gap-2">
              <span
                className={`text-lg font-bold capitalize ${
                  report.recommendation === "buy"
                    ? "text-green-600"
                    : report.recommendation === "sell" ||
                        report.recommendation === "avoid"
                      ? "text-red-600"
                      : report.recommendation === "wheel"
                        ? "text-blue-600"
                        : "text-amber-600"
                }`}
              >
                {report.recommendation}
              </span>
              <span className="text-muted-foreground text-xs">
                {Math.round(report.confidence * 100)}% confidence
              </span>
            </div>
          </InfoBullet>
        )}

        {/* Fundamentals */}
        {fundamentalsAnalysis && fund && (fund.pe != null || fund.marketCap != null || fund.roe != null) && (
          <InfoBullet label="Fundamentals" signal={fundamentalsAnalysis.signal}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {fund.marketCap != null && (
                <MetricItem label="Mkt Cap" value={fmtCap(fund.marketCap)} tip="Market Capitalization" />
              )}
              {fund.pe != null && (
                <MetricItem
                  label="P/E"
                  value={fmt(fund.pe, 1)}
                  color={fund.pe > 0 && fund.pe < 15 ? "green" : fund.pe > 40 ? "red" : undefined}
                  tip="Price-to-Earnings Ratio"
                />
              )}
              {fund.forwardPe != null && (
                <MetricItem
                  label="Fwd P/E"
                  value={fmt(fund.forwardPe, 1)}
                  color={fund.forwardPe > 0 && fund.forwardPe < 15 ? "green" : fund.forwardPe > 30 ? "red" : undefined}
                  tip="Forward Price-to-Earnings Ratio (based on estimated future earnings)"
                />
              )}
              {fund.eps != null && (
                <MetricItem label="EPS" value={fmt(fund.eps, 2)} tip="Earnings Per Share" />
              )}
              {fund.epsGrowth != null && (
                <MetricItem
                  label="EPS Growth"
                  value={`${fund.epsGrowth.toFixed(1)}%`}
                  color={fund.epsGrowth > 20 ? "green" : fund.epsGrowth < -10 ? "red" : undefined}
                />
              )}
              {fund.revenueGrowth != null && (
                <MetricItem
                  label="Rev Growth"
                  value={`${fund.revenueGrowth.toFixed(1)}%`}
                  color={fund.revenueGrowth > 15 ? "green" : fund.revenueGrowth < -5 ? "red" : undefined}
                  tip="Revenue Growth (year-over-year)"
                />
              )}
              {fund.roe != null && (
                <MetricItem
                  label="ROE"
                  value={`${fund.roe.toFixed(1)}%`}
                  color={fund.roe > 20 ? "green" : fund.roe < 5 ? "red" : undefined}
                  tip="Return on Equity"
                />
              )}
              {fund.profitMargin != null && (
                <MetricItem
                  label="Margin"
                  value={`${fund.profitMargin.toFixed(1)}%`}
                  color={fund.profitMargin > 20 ? "green" : fund.profitMargin < 0 ? "red" : undefined}
                />
              )}
              {fund.debtToEquity != null && (
                <MetricItem
                  label="D/E"
                  value={`${fund.debtToEquity.toFixed(0)}%`}
                  color={fund.debtToEquity < 50 ? "green" : fund.debtToEquity > 200 ? "red" : undefined}
                  tip="Debt-to-Equity Ratio"
                />
              )}
              {fund.dividendYield != null && fund.dividendYield > 0 && (
                <MetricItem label="Div Yield" value={`${fund.dividendYield.toFixed(2)}%`} tip="Dividend Yield (annual dividend / share price)" />
              )}
              {fund.beta != null && (
                <MetricItem label="Beta" value={fmt(fund.beta, 2)} />
              )}
              {fund.priceToBook != null && (
                <MetricItem label="P/B" value={fmt(fund.priceToBook, 1)} tip="Price-to-Book Ratio" />
              )}
            </div>
          </InfoBullet>
        )}

        {/* Technical */}
        {technical && (
          <InfoBullet label="Technical" signal={technical.signal}>
            <div className="space-y-0.5 text-xs">
              <div className="flex items-center gap-2">
                <MetricItem
                  label="Trend"
                  value={trendLabel(techD.trend as string)}
                  color={
                    technical.signal === "bullish" ? "green" :
                    technical.signal === "bearish" ? "red" : "amber"
                  }
                />
                <MetricItem
                  label="RSI"
                  value={fmt(techD.rsi14, 0)}
                  color={
                    (techD.rsi14 as number) > 70 ? "red" :
                    (techD.rsi14 as number) < 30 ? "green" : undefined
                  }
                  tip="Relative Strength Index (14-day). Below 30 = oversold, above 70 = overbought"
                />
              </div>
              <div className="text-muted-foreground">
                ${fmt(techD.currentPrice)} · <Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">SMA50</span></TooltipTrigger><TooltipContent>50-day Simple Moving Average</TooltipContent></Tooltip> ${fmt(techD.sma50)} · <Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">SMA200</span></TooltipTrigger><TooltipContent>200-day Simple Moving Average</TooltipContent></Tooltip> ${fmt(techD.sma200)}
              </div>
              {(techD.support != null || techD.resistance != null) && (
                <div className="text-muted-foreground">
                  {techD.support != null && <><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">S</span></TooltipTrigger><TooltipContent>Support level</TooltipContent></Tooltip>: ${fmt(techD.support)}</>}
                  {techD.support != null && techD.resistance != null && " · "}
                  {techD.resistance != null && <><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">R</span></TooltipTrigger><TooltipContent>Resistance level</TooltipContent></Tooltip>: ${fmt(techD.resistance)}</>}
                </div>
              )}
            </div>
          </InfoBullet>
        )}

        {/* Options */}
        {options && (
          <InfoBullet label="Options" signal={options.signal}>
            <div className="flex flex-wrap gap-x-3 text-xs">
              <MetricItem
                label="IV Rank"
                value={fmt(optD.ivRank, 0)}
                color={
                  (optD.ivRank as number) > 50 ? "green" :
                  (optD.ivRank as number) < 20 ? "red" : undefined
                }
                tip="Implied Volatility Rank — current IV relative to its 52-week range"
              />
              <MetricItem label="P/C" value={fmt(optD.putCallRatio)} tip="Put/Call Ratio — ratio of put volume to call volume" />
              {optD.wheelSuitability != null && (
                <MetricItem
                  label="Wheel"
                  value={`${((optD.wheelSuitability as number) * 100).toFixed(0)}%`}
                  color={
                    (optD.wheelSuitability as number) >= 0.7 ? "green" :
                    (optD.wheelSuitability as number) >= 0.4 ? "amber" : "red"
                  }
                  tip="Wheel Strategy Suitability Score"
                />
              )}
            </div>
          </InfoBullet>
        )}

        {/* Social */}
        {social && (
          <InfoBullet label="Social" signal={social.signal}>
            <div className="flex flex-wrap gap-x-3 text-xs">
              <MetricItem
                label="Sentiment"
                value={`${(socialD.sentimentScore as number) > 0 ? "+" : ""}${fmt(socialD.sentimentScore)}`}
                color={
                  (socialD.sentimentScore as number) > 0.1 ? "green" :
                  (socialD.sentimentScore as number) < -0.1 ? "red" : undefined
                }
              />
              <MetricItem label="Mentions" value={fmt(socialD.mentionCount, 0)} />
            </div>
          </InfoBullet>
        )}

        {/* Events */}
        {events && (eventsD.nextEarnings != null || eventsD.nextExDividend != null) && (
          <InfoBullet label="Events">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {eventsD.nextEarnings != null && (
                <MetricItem
                  label="Earnings"
                  value={`${String(eventsD.nextEarnings)}${daysUntil(eventsD.nextEarnings as string) ? ` (${daysUntil(eventsD.nextEarnings as string)})` : ""}`}
                />
              )}
              {eventsD.nextExDividend != null && (
                <MetricItem
                  label="Ex-Div"
                  value={`${String(eventsD.nextExDividend)}${daysUntil(eventsD.nextExDividend as string) ? ` (${daysUntil(eventsD.nextExDividend as string)})` : ""}`}
                  tip="Ex-Dividend Date — buy before this date to receive the dividend"
                />
              )}
              {eventsD.dividendYield != null && (
                <MetricItem label="Yield" value={pct(eventsD.dividendYield)} />
              )}
              {eventsD.dividendGrowth != null && (
                <MetricItem label="Div Growth" value={trendLabel(eventsD.dividendGrowth as string)} />
              )}
            </div>
          </InfoBullet>
        )}
      </CardContent>
    </Card>
  );
}

// --- Options Landscape Section ---

interface OptionsChainRow {
  symbol: string;
  expiration: string;
  strike: number;
  right: "C" | "P";
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
}

interface UnusualActivityRow {
  symbol: string;
  expiration: string;
  strike: number;
  right: "C" | "P";
  volume: number;
  openInterest: number;
  ratio: number;
}

function OptionsLandscapeSection({
  analysis,
  collections,
}: {
  analysis: AnalysisResult | undefined;
  collections: Map<string, CollectionDataEntry>;
}) {
  const [expandedExpiry, setExpandedExpiry] = useState<Set<string>>(new Set());

  const optD = det(analysis);
  const rawData = collections.get("options")?.data as
    | { chain?: OptionsChainRow[]; symbol?: string; fetchedAt?: string }
    | undefined;
  const chain = rawData?.chain ?? [];

  // Nothing to show if no analysis and no chain
  if (!analysis && chain.length === 0) return null;

  const ivRank = optD.ivRank as number | undefined;
  const avgIV = optD.avgIV as number | undefined;
  const putCallRatio = optD.putCallRatio as number | null | undefined;
  const totalCallVolume = (optD.totalCallVolume as number) ?? 0;
  const totalPutVolume = (optD.totalPutVolume as number) ?? 0;
  const wheelSuitability = optD.wheelSuitability as number | undefined;
  const unusualActivity = (optD.unusualActivity as UnusualActivityRow[]) ?? [];

  // Group chain by expiration
  const byExpiry = new Map<string, OptionsChainRow[]>();
  for (const row of chain) {
    const list = byExpiry.get(row.expiration) ?? [];
    list.push(row);
    byExpiry.set(row.expiration, list);
  }
  const expirations = [...byExpiry.keys()].sort();

  const toggleExpiry = (exp: string) => {
    setExpandedExpiry((prev) => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  };

  const totalVolume = totalCallVolume + totalPutVolume;
  const callPct = totalVolume > 0 ? (totalCallVolume / totalVolume) * 100 : 50;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-violet-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-violet-600">
            Options Landscape
          </span>
          {analysis && (
            <SignalIcon signal={analysis.signal} />
          )}
          {analysis?.summary && (
            <span className="text-xs text-muted-foreground ml-1 line-clamp-1">
              {analysis.summary}
            </span>
          )}
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {ivRank != null && (
            <OptionMetricCard
              label="IV Rank"
              value={`${ivRank.toFixed(0)}%`}
              bar={ivRank}
              color={ivRank > 50 ? "green" : ivRank < 20 ? "red" : "amber"}
              tip="Implied Volatility Rank — current IV relative to its 52-week range"
            />
          )}
          {avgIV != null && avgIV > 0 && (
            <OptionMetricCard
              label="Avg IV"
              value={`${(avgIV * 100).toFixed(1)}%`}
              bar={Math.min(avgIV * 100, 100)}
              color="neutral"
              tip="Average Implied Volatility across all option contracts"
            />
          )}
          {putCallRatio != null && (
            <OptionMetricCard
              label="Put/Call Ratio"
              value={putCallRatio.toFixed(2)}
              bar={Math.min(putCallRatio * 50, 100)}
              color={putCallRatio > 1.5 ? "red" : putCallRatio < 0.7 ? "green" : "amber"}
            />
          )}
          {wheelSuitability != null && (
            <OptionMetricCard
              label="Wheel Score"
              value={`${(wheelSuitability * 100).toFixed(0)}%`}
              bar={wheelSuitability * 100}
              color={wheelSuitability >= 0.7 ? "green" : wheelSuitability >= 0.4 ? "amber" : "red"}
            />
          )}
        </div>

        {/* Volume Bar */}
        {totalVolume > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Calls: {totalCallVolume.toLocaleString()}</span>
              <span>Puts: {totalPutVolume.toLocaleString()}</span>
            </div>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${callPct}%` }}
              />
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${100 - callPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Unusual Activity */}
        {unusualActivity.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">
              Unusual Activity (Vol/OI &gt; 3x)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1 pr-3 font-medium"><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">Exp</span></TooltipTrigger><TooltipContent>Expiration Date</TooltipContent></Tooltip></th>
                    <th className="text-right py-1 px-2 font-medium">Strike</th>
                    <th className="text-center py-1 px-2 font-medium">Type</th>
                    <th className="text-right py-1 px-2 font-medium">Volume</th>
                    <th className="text-right py-1 px-2 font-medium"><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">OI</span></TooltipTrigger><TooltipContent>Open Interest — total number of outstanding contracts</TooltipContent></Tooltip></th>
                    <th className="text-right py-1 pl-2 font-medium">Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {unusualActivity.map((u, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3">{u.expiration}</td>
                      <td className="text-right py-1 px-2">{u.strike}</td>
                      <td className="text-center py-1 px-2">
                        <span className={u.right === "C" ? "text-green-600" : "text-red-600"}>
                          {u.right === "C" ? "Call" : "Put"}
                        </span>
                      </td>
                      <td className="text-right py-1 px-2">{u.volume.toLocaleString()}</td>
                      <td className="text-right py-1 px-2">{u.openInterest.toLocaleString()}</td>
                      <td className="text-right py-1 pl-2 font-medium">{u.ratio.toFixed(1)}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Chain by Expiration */}
        {expirations.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">
              Chain ({chain.length} contracts across {expirations.length} expiration{expirations.length !== 1 ? "s" : ""})
            </h3>
            <div className="space-y-1">
              {expirations.map((exp) => {
                const rows = byExpiry.get(exp)!;
                const calls = rows.filter((r) => r.right === "C");
                const puts = rows.filter((r) => r.right === "P");
                const expAvgIV = rows.reduce((s, r) => s + (r.impliedVolatility ?? 0), 0) / rows.length;
                const expVol = rows.reduce((s, r) => s + r.volume, 0);
                const isOpen = expandedExpiry.has(exp);

                return (
                  <div key={exp} className="border border-border/40 rounded-md">
                    <button
                      onClick={() => toggleExpiry(exp)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-muted/50 cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{exp}</span>
                        <span className="text-muted-foreground">
                          {calls.length}C / {puts.length}P
                        </span>
                        <span className="text-muted-foreground">
                          IV: {(expAvgIV * 100).toFixed(1)}%
                        </span>
                        <span className="text-muted-foreground">
                          Vol: {expVol.toLocaleString()}
                        </span>
                      </div>
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="text-right py-1 px-1.5 font-medium">Bid</th>
                              <th className="text-right py-1 px-1.5 font-medium">Ask</th>
                              <th className="text-right py-1 px-1.5 font-medium">Last</th>
                              <th className="text-right py-1 px-1.5 font-medium"><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">Vol</span></TooltipTrigger><TooltipContent>Volume — contracts traded today</TooltipContent></Tooltip></th>
                              <th className="text-right py-1 px-1.5 font-medium"><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">IV</span></TooltipTrigger><TooltipContent>Implied Volatility</TooltipContent></Tooltip></th>
                              <th className="text-right py-1 px-1.5 font-medium">Delta</th>
                              <th className="text-center py-1 px-2 font-bold bg-muted/50">Strike</th>
                              <th className="text-right py-1 px-1.5 font-medium">Delta</th>
                              <th className="text-right py-1 px-1.5 font-medium"><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">IV</span></TooltipTrigger><TooltipContent>Implied Volatility</TooltipContent></Tooltip></th>
                              <th className="text-right py-1 px-1.5 font-medium"><Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">Vol</span></TooltipTrigger><TooltipContent>Volume — contracts traded today</TooltipContent></Tooltip></th>
                              <th className="text-right py-1 px-1.5 font-medium">Last</th>
                              <th className="text-right py-1 px-1.5 font-medium">Bid</th>
                              <th className="text-right py-1 px-1.5 font-medium">Ask</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getStrikePairs(calls, puts).map((pair, i) => (
                              <tr key={i} className="border-b border-border/20">
                                {/* Call side */}
                                <td className="text-right py-0.5 px-1.5 text-green-700">{pair.call ? pair.call.bid.toFixed(2) : ""}</td>
                                <td className="text-right py-0.5 px-1.5 text-green-700">{pair.call ? pair.call.ask.toFixed(2) : ""}</td>
                                <td className="text-right py-0.5 px-1.5 text-green-700">{pair.call ? pair.call.last.toFixed(2) : ""}</td>
                                <td className="text-right py-0.5 px-1.5">{pair.call?.volume ?? ""}</td>
                                <td className="text-right py-0.5 px-1.5">{pair.call?.impliedVolatility != null ? `${(pair.call.impliedVolatility * 100).toFixed(0)}%` : ""}</td>
                                <td className="text-right py-0.5 px-1.5">{pair.call?.delta != null ? pair.call.delta.toFixed(2) : ""}</td>
                                {/* Strike */}
                                <td className="text-center py-0.5 px-2 font-semibold bg-muted/30">{pair.strike}</td>
                                {/* Put side */}
                                <td className="text-right py-0.5 px-1.5">{pair.put?.delta != null ? pair.put.delta.toFixed(2) : ""}</td>
                                <td className="text-right py-0.5 px-1.5">{pair.put?.impliedVolatility != null ? `${(pair.put.impliedVolatility * 100).toFixed(0)}%` : ""}</td>
                                <td className="text-right py-0.5 px-1.5">{pair.put?.volume ?? ""}</td>
                                <td className="text-right py-0.5 px-1.5 text-red-700">{pair.put ? pair.put.last.toFixed(2) : ""}</td>
                                <td className="text-right py-0.5 px-1.5 text-red-700">{pair.put ? pair.put.bid.toFixed(2) : ""}</td>
                                <td className="text-right py-0.5 px-1.5 text-red-700">{pair.put ? pair.put.ask.toFixed(2) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OptionMetricCard({
  label,
  value,
  bar,
  color,
  tip,
}: {
  label: string;
  value: string;
  bar: number;
  color: "green" | "red" | "amber" | "neutral";
  tip?: string;
}) {
  const barColor =
    color === "green" ? "bg-green-500" :
    color === "red" ? "bg-red-500" :
    color === "amber" ? "bg-amber-500" : "bg-slate-400";

  return (
    <div className="bg-muted/30 rounded-md px-3 py-2">
      <div className="text-[11px] text-muted-foreground mb-0.5">
        {tip ? (
          <Tooltip><TooltipTrigger asChild><span className="underline decoration-dotted cursor-help">{label}</span></TooltipTrigger><TooltipContent>{tip}</TooltipContent></Tooltip>
        ) : label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
      <div className="h-1 rounded-full bg-muted mt-1.5">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${Math.min(Math.max(bar, 2), 100)}%` }}
        />
      </div>
    </div>
  );
}

function getStrikePairs(
  calls: OptionsChainRow[],
  puts: OptionsChainRow[],
): Array<{ strike: number; call: OptionsChainRow | null; put: OptionsChainRow | null }> {
  const callMap = new Map(calls.map((c) => [c.strike, c]));
  const putMap = new Map(puts.map((p) => [p.strike, p]));
  const strikes = [...new Set([...callMap.keys(), ...putMap.keys()])].sort((a, b) => a - b);
  return strikes.map((strike) => ({
    strike,
    call: callMap.get(strike) ?? null,
    put: putMap.get(strike) ?? null,
  }));
}

// --- Comments Section ---

interface SAArticle {
  id: string;
  title: string;
  publishedAt: string;
  comments: Array<{
    id: string;
    content: string;
    createdAt: string;
    likes: number;
  }>;
}

interface SocialPost {
  source: "reddit" | "stocktwits";
  title: string | null;
  body: string;
  timestamp: string;
  score: number | null;
  comments: number | null;
  subreddit: string | null;
  sentiment: string | null;
  url: string | null;
}

function CommentsSection({
  collections,
}: {
  collections: Map<string, CollectionDataEntry>;
}) {
  const [showAllSA, setShowAllSA] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [showAllReddit, setShowAllReddit] = useState(false);
  const [showAllST, setShowAllST] = useState(false);

  // Extract SA comments data
  const saData = collections.get("sa_comments")?.data as
    | { articles?: SAArticle[] }
    | undefined;
  const saArticles = saData?.articles ?? [];
  const totalSAComments = saArticles.reduce((sum, a) => sum + a.comments.length, 0);

  // Extract social posts
  const socialData = collections.get("social")?.data as
    | { posts?: SocialPost[] }
    | undefined;
  const allPosts = socialData?.posts ?? [];
  const redditPosts = allPosts.filter((p) => p.source === "reddit");
  const stocktwitsPosts = allPosts.filter((p) => p.source === "stocktwits");

  if (saArticles.length === 0 && redditPosts.length === 0 && stocktwitsPosts.length === 0) {
    return null;
  }

  const visibleSA = showAllSA ? saArticles : saArticles.slice(0, 10);

  const toggleComments = (articleId: string) => {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(articleId)) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
  };
  const visibleReddit = showAllReddit ? redditPosts : redditPosts.slice(0, 5);
  const visibleST = showAllST ? stocktwitsPosts : stocktwitsPosts.slice(0, 5);

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">Community Discussion</h2>
      <div className="space-y-4">
        {/* Seeking Alpha */}
        {saArticles.length > 0 && (
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-3">
                <SAIcon className="h-4 w-4 text-orange-500" />
                <span className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                  Seeking Alpha
                </span>
                <span className="text-xs text-muted-foreground">
                  {saArticles.length} article{saArticles.length !== 1 ? "s" : ""} · {totalSAComments} comment{totalSAComments !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-3">
                {visibleSA.map((article) => (
                  <div key={article.id}>
                    <div className="flex items-baseline gap-2 mb-1">
                      <a
                        href={`https://seekingalpha.com/article/${article.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:underline"
                      >
                        {article.title}
                      </a>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {timeAgo(article.publishedAt)}
                      </span>
                    </div>
                    {article.comments.length > 0 && (() => {
                      const commentsExpanded = expandedComments.has(article.id);
                      const visibleComments = commentsExpanded
                        ? article.comments
                        : article.comments.slice(0, 5);
                      return (
                        <div className="ml-3 space-y-1.5">
                          {visibleComments.map((comment) => (
                            <div
                              key={comment.id}
                              className="border-l-2 border-orange-200 pl-3 py-1"
                            >
                              <p className="text-xs text-foreground/80">{comment.content}</p>
                              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                {comment.likes > 0 && (
                                  <span className="flex items-center gap-1">
                                    <ThumbsUp className="h-3 w-3" />
                                    {comment.likes}
                                  </span>
                                )}
                                <span>{timeAgo(comment.createdAt)}</span>
                              </div>
                            </div>
                          ))}
                          {article.comments.length > 5 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-6 px-2"
                              onClick={() => toggleComments(article.id)}
                            >
                              {commentsExpanded
                                ? "Show less"
                                : `Show all ${article.comments.length} comments`}
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
              {saArticles.length > 10 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => setShowAllSA(!showAllSA)}
                >
                  {showAllSA ? "Show less" : `Show all ${saArticles.length} articles`}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Reddit */}
        {redditPosts.length > 0 && (
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-3">
                <RedditIcon className="h-4 w-4 text-orange-600" />
                <span className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                  Reddit
                </span>
                <span className="text-xs text-muted-foreground">
                  {redditPosts.length} post{redditPosts.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {visibleReddit.map((post, i) => (
                  <div
                    key={i}
                    className="bg-muted/30 rounded-md px-3 py-2"
                  >
                    {post.title && (
                      <p className="text-sm font-medium mb-0.5">
                        {post.url ? (
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {post.title}
                          </a>
                        ) : (
                          post.title
                        )}
                      </p>
                    )}
                    <p className="text-xs text-foreground/80 line-clamp-3">{post.body}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {post.subreddit && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          r/{post.subreddit}
                        </Badge>
                      )}
                      {post.score != null && post.score > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <TrendingUp className="h-3 w-3" />
                          {post.score}
                        </span>
                      )}
                      {post.comments != null && post.comments > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {post.comments} comment{post.comments !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(post.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {redditPosts.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => setShowAllReddit(!showAllReddit)}
                >
                  {showAllReddit ? "Show less" : `Show all ${redditPosts.length} posts`}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* StockTwits */}
        {stocktwitsPosts.length > 0 && (
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-3">
                <StockTwitsIcon className="h-4 w-4 text-teal-500" />
                <span className="text-xs font-semibold uppercase tracking-wide text-teal-600">
                  StockTwits
                </span>
                <span className="text-xs text-muted-foreground">
                  {stocktwitsPosts.length} post{stocktwitsPosts.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {visibleST.map((post, i) => (
                  <div
                    key={i}
                    className="bg-muted/30 rounded-md px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-foreground/80 flex-1">{post.body}</p>
                      {post.sentiment && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 shrink-0 ${
                            post.sentiment === "Bullish"
                              ? "bg-green-500/15 text-green-700"
                              : post.sentiment === "Bearish"
                                ? "bg-red-500/15 text-red-700"
                                : ""
                          }`}
                        >
                          {post.sentiment}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1">
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(post.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {stocktwitsPosts.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => setShowAllST(!showAllST)}
                >
                  {showAllST ? "Show less" : `Show all ${stocktwitsPosts.length} posts`}
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// --- Skipped Sources ---

function SkippedSourcesSection({ skipped }: { skipped: CollectionStatus[] }) {
  // Hide authorization/subscription failures — these are permanent, not actionable
  const actionable = skipped.filter(
    (s) => !s.skipReason?.includes("403") && !s.skipReason?.includes("not authorized"),
  );
  if (actionable.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold mb-2 text-muted-foreground flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Unavailable Data Sources
      </h2>
      <div className="flex flex-wrap gap-2">
        {actionable.map((s) => (
          <div
            key={s.source}
            className="bg-muted/50 rounded-md px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span className="font-medium">
              {s.source.replace(/_/g, " ")}
            </span>
            {s.skipReason && <span className="ml-1">— {s.skipReason}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helpers ---

function formatMarketCap(value: number | null): string {
  if (value === null) return "\u2014";
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  return value.toLocaleString();
}

// --- Main Page ---

export function ResearchReportPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<ResearchReport | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [skipped, setSkipped] = useState<CollectionStatus[]>([]);
  const [collections, setCollections] = useState<CollectionDataEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: profile } = useTickerProfile(symbol ?? null);

  const fetchData = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    try {
      const [reportResult, analysisResult, collectionResult] =
        await Promise.allSettled([
          researchApi.getReport(symbol),
          researchApi.getAnalysis(symbol),
          researchApi.getCollectionData(symbol),
        ]);

      if (reportResult.status === "fulfilled") setReport(reportResult.value);
      if (analysisResult.status === "fulfilled") {
        setAnalyses(analysisResult.value.analyses);
        setSkipped(analysisResult.value.collectionStatuses ?? []);
      }
      if (collectionResult.status === "fulfilled") {
        setCollections(collectionResult.value.collections);
      }
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!symbol) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No symbol specified.
      </div>
    );
  }

  if (loading) return <PageLoadingSkeleton />;

  // Prepare data
  const collectionMap = new Map<string, CollectionDataEntry>();
  for (const c of collections) collectionMap.set(c.source, c);

  const technical = getAnalysis(analyses, "technical");
  const social = getAnalysis(analyses, "social");
  const fundamentals = getAnalysis(analyses, "fundamentals");
  const saComments = getAnalysis(analyses, "sa_comments");
  const options = getAnalysis(analyses, "options");

  const techD = det(technical);
  const socialD = det(social);
  const fundD = det(fundamentals);
  const optD = det(options);
  const saCommentsD = det(saComments);

  // Bull/Bear points
  const keyIdeas =
    (saCommentsD.keyIdeas as Array<{
      idea: string;
      stance: string;
      mentions: number;
    }>) ?? [];
  const catalysts = (saCommentsD.catalysts as string[]) ?? [];
  const risks = (saCommentsD.risks as string[]) ?? [];
  const bullPoints = [
    ...keyIdeas.filter((k) => k.stance === "bullish").map((k) => k.idea),
    ...catalysts,
  ].slice(0, 5);
  const bearPoints = [
    ...keyIdeas.filter((k) => k.stance === "bearish").map((k) => k.idea),
    ...risks,
  ].slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/analysis")}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <TickerHoverCard symbol={symbol}>
              <a
                href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xl font-bold hover:text-primary hover:underline"
              >
                {symbol}
              </a>
            </TickerHoverCard>
            <ExternalLinks symbol={symbol} />
          </span>
          {report && (
            <RecommendationBadge
              recommendation={report.recommendation}
              confidence={report.confidence}
            />
          )}
        </div>
        {report && (
          <span className="text-sm text-muted-foreground ml-auto">
            Updated {timeAgo(report.createdAt)}
          </span>
        )}
      </div>

      {/* Profile Card */}
      {profile && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-6">
              {/* Left: company info */}
              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <span className="text-lg font-semibold">{profile.companyName}</span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {profile.sector && (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {profile.sector}
                    </span>
                  )}
                  {profile.industry && (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {profile.industry}
                    </span>
                  )}
                  {profile.marketPosition && (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      {profile.marketPosition}
                    </span>
                  )}
                </div>
                {profile.description && (
                  <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                    {profile.description}
                  </p>
                )}
              </div>

              {/* Right: metrics + sparkline */}
              <div className="shrink-0 space-y-2 w-48">
                <div className="flex justify-between text-xs">
                  <div>
                    <span className="text-muted-foreground">MCap </span>
                    <span>{formatMarketCap(profile.marketCap)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">P/E </span>
                    <span>{profile.peRatio !== null ? profile.peRatio.toFixed(1) : "\u2014"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Div </span>
                    <span>{profile.dividendYield !== null ? `${profile.dividendYield.toFixed(2)}%` : "\u2014"}</span>
                  </div>
                </div>
                {profile.chart.length > 0 && (
                  <div className="h-[60px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={profile.chart}>
                        <defs>
                          <linearGradient id={`page-gradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={profile.chart[profile.chart.length - 1].close >= profile.chart[0].close ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={profile.chart[profile.chart.length - 1].close >= profile.chart[0].close ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <YAxis domain={["dataMin", "dataMax"]} hide />
                        <Area
                          type="monotone"
                          dataKey="close"
                          stroke={profile.chart[profile.chart.length - 1].close >= profile.chart[0].close ? "#22c55e" : "#ef4444"}
                          strokeWidth={1.5}
                          fill={`url(#page-gradient-${symbol})`}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart + Company Info Panel (two columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Chart — 3 of 5 columns */}
        <Card className="lg:col-span-3 overflow-hidden">
          <CardContent className="p-0">
            {/* Outer clips the copyright, inner is taller to push it out */}
            <div className="overflow-hidden" style={{ height: 460 }}>
              <div style={{ height: 490 }}>
                <AdvancedRealTimeChart
                  symbol={symbol}
                  theme="light"
                  autosize
                  interval="D"
                  range="12M"
                  hide_side_toolbar
                  allow_symbol_change={false}
                  style="1"
                  studies={
                    [
                      "RSI@tv-basicstudies",
                      "MAExp@tv-basicstudies",
                    ] as never
                  }
                  {...{
                    studies_overrides: {
                      "moving average exponential.length": 200,
                    },
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Company Info Panel — 2 of 5 columns */}
        <CompanyInfoPanel
          report={report}
          analyses={analyses}
          techD={techD}
          socialD={socialD}
          fundD={fundD}
          optD={optD}
        />
      </div>

      {/* Summary */}
      {report && (
        <Card>
          <CardContent className="py-3 px-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Summary
            </h2>
            <p className="text-sm">{report.summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Bull & Bear Cases */}
      {(bullPoints.length > 0 || bearPoints.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bullPoints.length > 0 && (
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="py-3 px-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-green-600 mb-2">
                  Bull Case
                </h2>
                <ul className="space-y-1">
                  {bullPoints.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-green-600 shrink-0">+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {bearPoints.length > 0 && (
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="py-3 px-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-2">
                  Bear Case
                </h2>
                <ul className="space-y-1">
                  {bearPoints.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="text-red-600 shrink-0">-</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Options Landscape */}
      <OptionsLandscapeSection analysis={options} collections={collectionMap} />

      {/* Full Report (collapsible) */}
      {report?.fullReport && (
        <Collapsible>
          <Card>
            <CardContent className="py-3 px-4">
              <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Full AI Report
                </h2>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none mt-3">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {report.fullReport}
                  </Markdown>
                </div>
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      )}

      {/* Community Discussion */}
      <CommentsSection collections={collectionMap} />

      {/* Unavailable Data Sources */}
      <SkippedSourcesSection skipped={skipped} />

      {/* No report placeholder */}
      {!report && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="font-medium">No report available for {symbol}</p>
            <p className="text-sm mt-1">
              Go back and click &quot;Generate&quot; to create a report.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
