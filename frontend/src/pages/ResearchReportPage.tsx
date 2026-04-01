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
import { RecommendationBadge, PageLoadingSkeleton } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RawDataView } from "@/components/research/RawDataView";
import { timeAgo } from "@/utils/format";

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

function signalColor(signal: string | undefined) {
  if (signal === "bullish") return "text-green-600";
  if (signal === "bearish") return "text-red-600";
  return "text-amber-600";
}

function levelColor(level: string | undefined) {
  if (level === "high" || level === "extreme") return "text-red-600";
  if (level === "moderate") return "text-amber-600";
  return "text-green-600";
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

// --- Events Panel ---

function EventsPanel({
  analyses,
  collections,
}: {
  analyses: AnalysisResult[];
  collections: Map<string, CollectionDataEntry>;
}) {
  const events = getAnalysis(analyses, "events");
  const eventsData = collections.get("events")?.data as
    | Record<string, unknown>
    | undefined;

  const d = det(events);
  const earnings = (eventsData?.earnings ?? []) as Array<
    Record<string, unknown>
  >;
  const dividends = (eventsData?.dividends ?? []) as Array<
    Record<string, unknown>
  >;

  if (!events && earnings.length === 0 && dividends.length === 0) return null;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Events & Calendar
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          {d.nextEarnings != null && (
            <div className="bg-blue-500/10 rounded-md px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Earnings: </span>
              <span className="font-medium">{String(d.nextEarnings)}</span>
              {daysUntil(d.nextEarnings as string) && (
                <span className="text-muted-foreground ml-1">
                  ({daysUntil(d.nextEarnings as string)})
                </span>
              )}
            </div>
          )}
          {d.nextExDividend != null && (
            <div className="bg-purple-500/10 rounded-md px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Ex-Div: </span>
              <span className="font-medium">{String(d.nextExDividend)}</span>
              {daysUntil(d.nextExDividend as string) && (
                <span className="text-muted-foreground ml-1">
                  ({daysUntil(d.nextExDividend as string)})
                </span>
              )}
            </div>
          )}
          {d.dividendYield != null && (
            <div className="bg-green-500/10 rounded-md px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Yield: </span>
              <span className="font-medium">{pct(d.dividendYield)}</span>
            </div>
          )}
          {d.dividendGrowth != null && (
            <div className="bg-green-500/10 rounded-md px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Div Growth: </span>
              <span className="font-medium">
                {trendLabel(d.dividendGrowth as string)}
              </span>
            </div>
          )}
          {earnings.length > 0 && (
            <div className="w-full mt-1">
              <div className="text-xs text-muted-foreground mb-1">
                Recent Earnings
              </div>
              <div className="flex flex-wrap gap-2">
                {earnings.slice(0, 4).map((e, i) => (
                  <div
                    key={i}
                    className="bg-muted/50 rounded px-2 py-1 text-xs flex gap-2"
                  >
                    <span>{String(e.date ?? "--")}</span>
                    {e.epsEstimate != null && (
                      <span className="text-muted-foreground">
                        Est: {fmt(e.epsEstimate as number)}
                      </span>
                    )}
                    {e.epsActual != null && (
                      <span>Act: {fmt(e.epsActual as number)}</span>
                    )}
                    {e.surprise != null && (
                      <span
                        className={
                          (e.surprise as number) >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }
                      >
                        {(e.surprise as number) >= 0 ? "+" : ""}
                        {fmt(e.surprise as number)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {dividends.length > 0 && (
            <div className="w-full mt-1">
              <div className="text-xs text-muted-foreground mb-1">
                Recent Dividends
              </div>
              <div className="flex flex-wrap gap-2">
                {dividends.slice(0, 4).map((dv, i) => (
                  <div
                    key={i}
                    className="bg-muted/50 rounded px-2 py-1 text-xs flex gap-2"
                  >
                    <span>{String(dv.date ?? dv.exDate ?? "--")}</span>
                    {dv.amount != null && (
                      <span>${fmt(dv.amount as number, 4)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Additional Info Section ---

const ADDITIONAL_SOURCE_LABELS: Record<string, string> = {
  seeking_alpha: "Seeking Alpha Details",
  sa_comments: "Seeking Alpha Community Discussion",
  sec_filings: "SEC Filings & Insider Activity",
  options: "Options Flow Details",
  macro: "Macro Context",
  technical: "Technical Data",
};

function AdditionalInfoCard({
  label,
  analysis,
  collection,
}: {
  label: string;
  analysis?: AnalysisResult;
  collection: CollectionDataEntry;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardContent className="py-2 px-4">
          <CollapsibleTrigger className="flex items-center justify-between w-full cursor-pointer">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{label}</span>
              {analysis && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    analysis.signal === "bullish"
                      ? "bg-green-500/15 text-green-700"
                      : analysis.signal === "bearish"
                        ? "bg-red-500/15 text-red-700"
                        : "bg-amber-500/15 text-amber-700"
                  }`}
                >
                  {analysis.signal}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 pt-2 border-t text-xs">
              {analysis && (
                <p className="text-sm text-muted-foreground mb-2">
                  {analysis.summary}
                </p>
              )}
              <RawDataView collection={collection} />
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}

function AdditionalInfoSection({
  analyses,
  collections,
}: {
  analyses: AnalysisResult[];
  collections: Map<string, CollectionDataEntry>;
}) {
  const sourcesToShow = [
    "seeking_alpha",
    "sa_comments",
    "sec_filings",
    "options",
    "macro",
  ];
  const items: {
    source: string;
    label: string;
    analysis?: AnalysisResult;
    collection: CollectionDataEntry;
  }[] = [];

  for (const source of sourcesToShow) {
    const analysis = getAnalysis(analyses, source);
    const collection = collections.get(source);
    if (collection) {
      items.push({
        source,
        label: ADDITIONAL_SOURCE_LABELS[source] ?? source,
        analysis,
        collection,
      });
    }
  }

  if (items.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold mb-3">Additional Information</h2>
      <div className="space-y-2">
        {items.map(({ source, label, analysis, collection }) => (
          <AdditionalInfoCard
            key={source}
            label={label}
            analysis={analysis}
            collection={collection}
          />
        ))}
      </div>
    </div>
  );
}

// --- Skipped Sources ---

function SkippedSourcesSection({ skipped }: { skipped: CollectionStatus[] }) {
  if (skipped.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold mb-2 text-muted-foreground flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Unavailable Data Sources
      </h2>
      <div className="flex flex-wrap gap-2">
        {skipped.map((s) => (
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

// --- Main Page ---

export function ResearchReportPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<ResearchReport | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [skipped, setSkipped] = useState<CollectionStatus[]>([]);
  const [collections, setCollections] = useState<CollectionDataEntry[]>([]);
  const [loading, setLoading] = useState(true);

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
  const seekingAlpha = getAnalysis(analyses, "seeking_alpha");
  const shortInterest = getAnalysis(analyses, "short_interest");
  const saComments = getAnalysis(analyses, "sa_comments");
  const options = getAnalysis(analyses, "options");

  const techD = det(technical);
  const socialD = det(social);
  const saD = det(seekingAlpha);
  const shortD = det(shortInterest);
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

  // Fundamentals metrics
  const metrics = saD.metrics as Record<string, number | undefined> | null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/research")}
          className="gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{symbol}</h1>
          {report && (
            <RecommendationBadge
              recommendation={report.recommendation}
              confidence={report.confidence}
            />
          )}
          <div className="flex items-center gap-1.5">
            <a
              href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-50 hover:opacity-100 transition-opacity"
              title="View on TradingView"
            >
              <svg viewBox="0 0 36 28" className="h-5 w-5" fill="currentColor">
                <path d="M14 22H7V6h7v16zm8-12h-7v12h7V10zm8 4h-7v8h7v-8z" />
              </svg>
            </a>
            <a
              href={`https://seekingalpha.com/symbol/${symbol}`}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-50 hover:opacity-100 transition-opacity"
              title="View on Seeking Alpha"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 5h3.5l-4.5 5h3l-5 5 2-3.5H7L10.5 7z" />
              </svg>
            </a>
          </div>
        </div>
        {report && (
          <span className="text-sm text-muted-foreground ml-auto">
            Updated {timeAgo(report.createdAt)}
          </span>
        )}
      </div>

      {/* Chart + Key Info (two columns) */}
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

        {/* Key Info Panel — 2 of 5 columns */}
        <Card className="lg:col-span-2">
          <CardContent className="py-3 px-4">
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

            {/* Technical */}
            {technical && (
              <InfoBullet label="Technical" signal={technical.signal}>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        signalColor(technical.signal) + " font-medium"
                      }
                    >
                      {trendLabel(techD.trend as string)}
                    </span>
                    <span className="text-muted-foreground">
                      RSI {fmt(techD.rsi14, 0)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${fmt(techD.currentPrice)} · SMA50 ${fmt(techD.sma50)} ·
                    SMA200 ${fmt(techD.sma200)}
                  </div>
                </div>
              </InfoBullet>
            )}

            {/* Social Sentiment */}
            {social && (
              <InfoBullet label="Social Sentiment" signal={social.signal}>
                <div className="flex items-center gap-2">
                  <span
                    className={signalColor(
                      (socialD.sentimentScore as number) > 0.1
                        ? "bullish"
                        : (socialD.sentimentScore as number) < -0.1
                          ? "bearish"
                          : "neutral",
                    )}
                  >
                    {(socialD.sentimentScore as number) > 0 ? "+" : ""}
                    {fmt(socialD.sentimentScore)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {fmt(socialD.mentionCount, 0)} mentions
                  </span>
                </div>
              </InfoBullet>
            )}

            {/* Fundamentals */}
            {seekingAlpha && (metrics?.pe_nongaap_fy1 != null || metrics?.revenue_growth != null || saD.sellSideRating != null) && (
              <InfoBullet label="Fundamentals" signal={seekingAlpha.signal}>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {metrics?.pe_nongaap_fy1 != null && (
                    <span>
                      <span className="text-muted-foreground">P/E: </span>
                      <span
                        className={`font-medium ${
                          (metrics.pe_nongaap_fy1 as number) > 30
                            ? "text-red-600"
                            : (metrics.pe_nongaap_fy1 as number) < 15
                              ? "text-green-600"
                              : ""
                        }`}
                      >
                        {fmt(metrics.pe_nongaap_fy1, 1)}
                      </span>
                    </span>
                  )}
                  {metrics?.revenue_growth != null && (
                    <span>
                      <span className="text-muted-foreground">Rev: </span>
                      <span
                        className={`font-medium ${
                          (metrics.revenue_growth as number) > 0
                            ? "text-green-600"
                            : (metrics.revenue_growth as number) < 0
                              ? "text-red-600"
                              : ""
                        }`}
                      >
                        {pct(metrics.revenue_growth)}
                      </span>
                    </span>
                  )}
                  {saD.sellSideRating != null && (
                    <span>
                      <span className="text-muted-foreground">Rating: </span>
                      <span className="font-medium">
                        {fmt(saD.sellSideRating, 1)}/5
                      </span>
                    </span>
                  )}
                </div>
              </InfoBullet>
            )}

            {/* Options & IV */}
            {options && (
              <InfoBullet label="Options" signal={options.signal}>
                <div className="flex flex-wrap gap-x-3 text-xs">
                  <span>
                    <span className="text-muted-foreground">IV Rank: </span>
                    <span
                      className={
                        `font-medium ` + signalColor(options.signal)
                      }
                    >
                      {fmt(optD.ivRank, 0)}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">P/C: </span>
                    <span className="font-medium">
                      {fmt(optD.putCallRatio)}
                    </span>
                  </span>
                  {optD.wheelSuitability != null && (
                    <span>
                      <span className="text-muted-foreground">Wheel: </span>
                      <span
                        className={`font-medium ${
                          (optD.wheelSuitability as number) >= 0.7
                            ? "text-green-600"
                            : (optD.wheelSuitability as number) >= 0.4
                              ? "text-amber-600"
                              : "text-red-600"
                        }`}
                      >
                        {((optD.wheelSuitability as number) * 100).toFixed(0)}%
                      </span>
                    </span>
                  )}
                </div>
              </InfoBullet>
            )}

            {/* Short Interest */}
            {shortInterest && (
              <InfoBullet label="Short Interest" signal={shortInterest.signal}>
                <div className="flex flex-wrap gap-x-3 text-xs">
                  <span>
                    <span className="text-muted-foreground">Float: </span>
                    <span
                      className={
                        `font-medium ` +
                        levelColor(shortD.shortLevel as string)
                      }
                    >
                      {pct(shortD.shortPercentOfFloat)}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">DTC: </span>
                    <span className="font-medium">
                      {fmt(shortD.daysToCover, 1)}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {trendLabel(shortD.shortInterestTrend as string)}
                  </span>
                </div>
              </InfoBullet>
            )}

          </CardContent>
        </Card>
      </div>

      {/* Events Panel */}
      <EventsPanel analyses={analyses} collections={collectionMap} />

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

      {/* Additional Information */}
      <AdditionalInfoSection
        analyses={analyses}
        collections={collectionMap}
      />

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
