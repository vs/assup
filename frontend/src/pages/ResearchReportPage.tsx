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
  ThumbsUp,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { timeAgo } from "@/utils/format";

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

// --- Metric Item ---

function MetricItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "green" | "red" | "amber";
}) {
  const colorClass =
    color === "green" ? "text-green-600" :
    color === "red" ? "text-red-600" :
    color === "amber" ? "text-amber-600" : "";
  return (
    <span>
      <span className="text-muted-foreground">{label}: </span>
      <span className={`font-medium ${colorClass}`}>{value}</span>
    </span>
  );
}

// --- Company Info Panel ---

function CompanyInfoPanel({
  report,
  analyses,
  techD,
  socialD,
  saD,
  shortD,
  optD,
}: {
  report: ResearchReport | null;
  analyses: AnalysisResult[];
  techD: Record<string, unknown>;
  socialD: Record<string, unknown>;
  saD: Record<string, unknown>;
  shortD: Record<string, unknown>;
  optD: Record<string, unknown>;
}) {
  const technical = getAnalysis(analyses, "technical");
  const social = getAnalysis(analyses, "social");
  const seekingAlpha = getAnalysis(analyses, "seeking_alpha");
  const shortInterest = getAnalysis(analyses, "short_interest");
  const options = getAnalysis(analyses, "options");
  const events = getAnalysis(analyses, "events");
  const eventsD = det(events);

  const metrics = saD.metrics as Record<string, number | undefined> | null;

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
        {seekingAlpha && (metrics?.market_cap != null || metrics?.pe_nongaap_fy1 != null || metrics?.revenue_growth != null || metrics?.dividend_yield != null) && (
          <InfoBullet label="Fundamentals" signal={seekingAlpha.signal}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {metrics?.market_cap != null && (
                <MetricItem label="Mkt Cap" value={fmtCap(metrics.market_cap as number)} />
              )}
              {metrics?.pe_nongaap_fy1 != null && (
                <MetricItem
                  label="Fwd P/E"
                  value={fmt(metrics.pe_nongaap_fy1, 1)}
                  color={
                    (metrics.pe_nongaap_fy1 as number) < 15 ? "green" :
                    (metrics.pe_nongaap_fy1 as number) > 30 ? "red" : undefined
                  }
                />
              )}
              {metrics?.revenue_growth != null && (
                <MetricItem
                  label="Rev Growth"
                  value={pct(metrics.revenue_growth)}
                  color={
                    (metrics.revenue_growth as number) > 0 ? "green" :
                    (metrics.revenue_growth as number) < 0 ? "red" : undefined
                  }
                />
              )}
              {metrics?.dividend_yield != null && (
                <MetricItem label="Div Yield" value={pct(metrics.dividend_yield)} />
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
                />
              </div>
              <div className="text-muted-foreground">
                ${fmt(techD.currentPrice)} · SMA50 ${fmt(techD.sma50)} · SMA200 ${fmt(techD.sma200)}
              </div>
              {(techD.support != null || techD.resistance != null) && (
                <div className="text-muted-foreground">
                  {techD.support != null && <>S: ${fmt(techD.support)}</>}
                  {techD.support != null && techD.resistance != null && " · "}
                  {techD.resistance != null && <>R: ${fmt(techD.resistance)}</>}
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
              />
              <MetricItem label="P/C" value={fmt(optD.putCallRatio)} />
              {optD.wheelSuitability != null && (
                <MetricItem
                  label="Wheel"
                  value={`${((optD.wheelSuitability as number) * 100).toFixed(0)}%`}
                  color={
                    (optD.wheelSuitability as number) >= 0.7 ? "green" :
                    (optD.wheelSuitability as number) >= 0.4 ? "amber" : "red"
                  }
                />
              )}
            </div>
          </InfoBullet>
        )}

        {/* Short Interest */}
        {shortInterest && (
          <InfoBullet label="Short Interest" signal={shortInterest.signal}>
            <div className="flex flex-wrap gap-x-3 text-xs">
              <MetricItem
                label="S/O"
                value={typeof shortD.shortPercentOfSO === "number" ? `${(shortD.shortPercentOfSO as number).toFixed(1)}%` : "N/A"}
                color={
                  typeof shortD.shortPercentOfSO === "number"
                    ? (shortD.shortPercentOfSO as number) < 5 ? "green" :
                      (shortD.shortPercentOfSO as number) > 10 ? "red" : "amber"
                    : undefined
                }
              />
              {(shortD.daysToCover as number) > 0 && (
                <MetricItem
                  label="DTC"
                  value={fmt(shortD.daysToCover, 1)}
                  color={
                    (shortD.daysToCover as number) > 5 ? "red" :
                    (shortD.daysToCover as number) < 2 ? "green" : undefined
                  }
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

  const visibleSA = showAllSA ? saArticles : saArticles.slice(0, 3);
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
                      <span className="text-sm font-medium">{article.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {timeAgo(article.publishedAt)}
                      </span>
                    </div>
                    {article.comments.length > 0 && (
                      <div className="ml-3 space-y-1.5">
                        {article.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="border-l-2 border-orange-200 pl-3 py-1"
                          >
                            <p className="text-xs text-foreground/80">{comment.content}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <ThumbsUp className="h-3 w-3" />
                                {comment.likes}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {timeAgo(comment.createdAt)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {saArticles.length > 3 && (
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
                      <p className="text-sm font-medium mb-0.5">{post.title}</p>
                    )}
                    <p className="text-xs text-foreground/80 line-clamp-3">{post.body}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {post.subreddit && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          r/{post.subreddit}
                        </Badge>
                      )}
                      {post.score != null && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <TrendingUp className="h-3 w-3" />
                          {post.score}
                        </span>
                      )}
                      {post.comments != null && (
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
          saD={saD}
          shortD={shortD}
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
