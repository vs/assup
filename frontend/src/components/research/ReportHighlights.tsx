import type { ResearchReport, AnalysisResult } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  BarChart3,
  TrendingUp,
  Activity,
  CircleDot,
  Globe,
  DollarSign,
  AlertTriangle,
  MessageSquare,
  Calendar,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

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
  if (signal === "bullish") return "text-green-600 dark:text-green-400";
  if (signal === "bearish") return "text-red-600 dark:text-red-400";
  return "text-amber-600 dark:text-amber-400";
}

function signalBg(signal: string | undefined) {
  if (signal === "bullish") return "bg-green-500/15 text-green-700 dark:text-green-400";
  if (signal === "bearish") return "bg-red-500/15 text-red-700 dark:text-red-400";
  return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
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
  const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 0) return "Today";
  return `in ${diff}d`;
}

// --- Card building blocks ---

function HighlightCard({
  icon: Icon,
  title,
  children,
  className = "",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`${className}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${className}`}>{value}</span>
    </div>
  );
}

// --- Individual highlight cards ---

function RecommendationCard({ report }: { report: ResearchReport }) {
  return (
    <HighlightCard icon={Target} title="Recommendation" className="sm:col-span-2 lg:col-span-1">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold capitalize">{report.recommendation}</span>
        <Badge className={signalBg(
          report.recommendation === "buy" ? "bullish" :
          report.recommendation === "sell" || report.recommendation === "avoid" ? "bearish" : "neutral"
        )}>
          {Math.round(report.confidence * 100)}% confidence
        </Badge>
      </div>
    </HighlightCard>
  );
}

function SentimentCard({ analyses }: { analyses: AnalysisResult[] }) {
  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const a of analyses) {
    if (a.signal in counts) counts[a.signal as keyof typeof counts]++;
  }
  const total = analyses.length;
  if (total === 0) return null;

  return (
    <HighlightCard icon={BarChart3} title="Sentiment Overview">
      <div className="flex gap-3 text-sm">
        <span className="text-green-600 dark:text-green-400 font-medium">
          {counts.bullish} Bullish
        </span>
        <span className="text-amber-600 dark:text-amber-400 font-medium">
          {counts.neutral} Neutral
        </span>
        <span className="text-red-600 dark:text-red-400 font-medium">
          {counts.bearish} Bearish
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full overflow-hidden flex bg-muted">
        {counts.bullish > 0 && (
          <div className="bg-green-500 h-full" style={{ width: `${(counts.bullish / total) * 100}%` }} />
        )}
        {counts.neutral > 0 && (
          <div className="bg-amber-500 h-full" style={{ width: `${(counts.neutral / total) * 100}%` }} />
        )}
        {counts.bearish > 0 && (
          <div className="bg-red-500 h-full" style={{ width: `${(counts.bearish / total) * 100}%` }} />
        )}
      </div>
    </HighlightCard>
  );
}

function TechnicalCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  return (
    <HighlightCard icon={TrendingUp} title="Technical">
      <div className="space-y-1">
        <Row label="Trend" value={<span className={signalColor(a.signal)}>{trendLabel(d.trend as string)}</span>} />
        <Row label="Price" value={`$${fmt(d.currentPrice)}`} />
        <Row label="RSI (14)" value={fmt(d.rsi14)} />
        <Row label="SMA 50 / 200" value={`$${fmt(d.sma50)} / $${fmt(d.sma200)}`} />
        {(d.support != null || d.resistance != null) && (
          <Row label="S / R" value={`$${fmt(d.support)} / $${fmt(d.resistance)}`} />
        )}
      </div>
    </HighlightCard>
  );
}

function OptionsCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  return (
    <HighlightCard icon={Activity} title="Options & Volatility">
      <div className="space-y-1">
        <Row label="IV Rank" value={<span className={signalColor(a.signal)}>{fmt(d.ivRank, 0)}</span>} />
        <Row label="P/C Ratio" value={fmt(d.putCallRatio)} />
        <Row label="Avg IV" value={pct(d.avgIV)} />
      </div>
    </HighlightCard>
  );
}

function WheelCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const score = d.wheelSuitability as number | undefined;
  if (score == null) return null;
  const label = score >= 0.7 ? "Good" : score >= 0.4 ? "Fair" : "Poor";
  const color = score >= 0.7 ? "bullish" : score >= 0.4 ? "neutral" : "bearish";
  return (
    <HighlightCard icon={CircleDot} title="Wheel Suitability">
      <div className="flex items-center gap-2">
        <span className={`text-xl font-bold ${signalColor(color)}`}>{(score * 100).toFixed(0)}%</span>
        <Badge className={signalBg(color)}>{label}</Badge>
      </div>
    </HighlightCard>
  );
}

function MacroCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const regime = d.regime as string | undefined;
  const regimeColor = regime === "risk_on" ? "bullish" : regime === "risk_off" ? "bearish" : "neutral";
  return (
    <HighlightCard icon={Globe} title="Macro">
      <div className="space-y-1">
        <Row label="Regime" value={<Badge className={signalBg(regimeColor)}>{trendLabel(regime)}</Badge>} />
        <Row label="VIX" value={`${fmt(d.vix)} (${trendLabel(d.vixTrend as string)})`} />
        <Row label="S&P 500" value={`${fmt(d.sp500Index, 0)}`} />
        <Row label="vs SMA 200" value={trendLabel(d.sp500Trend as string)} />
      </div>
    </HighlightCard>
  );
}

function SeekingAlphaCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const metrics = d.metrics as Record<string, number | undefined> | null;
  return (
    <HighlightCard icon={DollarSign} title="Revenue & Growth">
      <div className="space-y-1">
        {metrics?.revenue_growth != null && (
          <Row label="Revenue Growth" value={<span className={signalColor(metrics.revenue_growth > 0 ? "bullish" : "bearish")}>{pct(metrics.revenue_growth)}</span>} />
        )}
        {metrics?.pe_nongaap_fy1 != null && (
          <Row label="Fwd P/E" value={fmt(metrics.pe_nongaap_fy1, 1)} />
        )}
      </div>
    </HighlightCard>
  );
}

function ShortInterestCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const level = d.shortLevel as string | undefined;
  const levelColor = level === "high" || level === "extreme" ? "bearish" : level === "moderate" ? "neutral" : "bullish";
  return (
    <HighlightCard icon={AlertTriangle} title="Short Interest">
      <div className="space-y-1">
        <Row label="% of Float" value={<span className={signalColor(levelColor)}>{pct(d.shortPercentOfFloat)}</span>} />
        <Row label="Days to Cover" value={fmt(d.daysToCover, 1)} />
        <Row label="Trend" value={trendLabel(d.shortInterestTrend as string)} />
        <Row label="Level" value={<Badge className={signalBg(levelColor)}>{trendLabel(level)}</Badge>} />
      </div>
    </HighlightCard>
  );
}

function SocialCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const score = d.sentimentScore as number | undefined;
  const sentimentColor = score != null ? (score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral") : "neutral";
  return (
    <HighlightCard icon={MessageSquare} title="Social Sentiment">
      <div className="space-y-1">
        <Row label="Mentions" value={fmt(d.mentionCount, 0)} />
        <Row label="Sentiment" value={<span className={signalColor(sentimentColor)}>{fmt(score)}</span>} />
      </div>
    </HighlightCard>
  );
}

function EventsCard({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const nextEarnings = d.nextEarnings as string | null;
  const nextExDiv = d.nextExDividend as string | null;
  const earningsDays = daysUntil(nextEarnings);
  return (
    <HighlightCard icon={Calendar} title="Upcoming Events">
      <div className="space-y-1">
        {nextEarnings && (
          <Row label="Earnings" value={`${nextEarnings}${earningsDays ? ` (${earningsDays})` : ""}`} />
        )}
        {nextExDiv && (
          <Row label="Ex-Dividend" value={nextExDiv} />
        )}
        {d.dividendYield != null && (
          <Row label="Div Yield" value={pct(d.dividendYield)} />
        )}
        <Row label="Div Growth" value={trendLabel(d.dividendGrowth as string)} />
      </div>
    </HighlightCard>
  );
}

interface KeyIdea {
  idea: string;
  stance: "bullish" | "bearish" | "neutral";
  mentions: number;
}

function BullBearCards({ a }: { a: AnalysisResult }) {
  const d = det(a);
  const keyIdeas = (d.keyIdeas as KeyIdea[] | undefined) ?? [];
  const catalysts = (d.catalysts as string[] | undefined) ?? [];
  const risks = (d.risks as string[] | undefined) ?? [];

  const bullIdeas = keyIdeas.filter((k) => k.stance === "bullish").slice(0, 3);
  const bearIdeas = keyIdeas.filter((k) => k.stance === "bearish").slice(0, 3);

  const bullPoints = [...bullIdeas.map((k) => k.idea), ...catalysts].slice(0, 3);
  const bearPoints = [...bearIdeas.map((k) => k.idea), ...risks].slice(0, 3);

  return (
    <>
      {bullPoints.length > 0 && (
        <HighlightCard icon={ThumbsUp} title="Bull Case">
          <ul className="space-y-1 text-sm">
            {bullPoints.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-green-600 dark:text-green-400 shrink-0">+</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </HighlightCard>
      )}
      {bearPoints.length > 0 && (
        <HighlightCard icon={ThumbsDown} title="Bear Case">
          <ul className="space-y-1 text-sm">
            {bearPoints.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-red-600 dark:text-red-400 shrink-0">-</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </HighlightCard>
      )}
    </>
  );
}

// --- Main component ---

interface ReportHighlightsProps {
  report: ResearchReport;
  analyses: AnalysisResult[];
}

export function ReportHighlights({ report, analyses }: ReportHighlightsProps) {
  const technical = getAnalysis(analyses, "technical");
  const options = getAnalysis(analyses, "options");
  const macro = getAnalysis(analyses, "macro");
  const seekingAlpha = getAnalysis(analyses, "seeking_alpha");
  const shortInterest = getAnalysis(analyses, "short_interest");
  const social = getAnalysis(analyses, "social");
  const events = getAnalysis(analyses, "events");
  const saComments = getAnalysis(analyses, "sa_comments");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <RecommendationCard report={report} />
      <SentimentCard analyses={analyses} />
      {technical && <TechnicalCard a={technical} />}
      {options && <OptionsCard a={options} />}
      {options && <WheelCard a={options} />}
      {macro && <MacroCard a={macro} />}
      {seekingAlpha && <SeekingAlphaCard a={seekingAlpha} />}
      {shortInterest && <ShortInterestCard a={shortInterest} />}
      {social && <SocialCard a={social} />}
      {events && <EventsCard a={events} />}
      {saComments && <BullBearCards a={saComments} />}
    </div>
  );
}
