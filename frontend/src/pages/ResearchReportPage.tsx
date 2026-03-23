import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Markdown } from "react-markdown";
import remarkGfm from "remark-gfm";
import { researchApi } from "@/api";
import type {
  ResearchReport,
  AnalysisResult,
  CollectionStatus,
  CollectionDataEntry,
  OHLCV,
} from "@assup/shared";
import { RecommendationBadge, PageLoadingSkeleton } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { PriceVolumeChart } from "@/components/research/PriceVolumeChart";
import { RsiChart } from "@/components/research/RsiChart";
import { SourceCard, SkippedSourceCard } from "@/components/research/SourceCard";

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const hours = Math.round(
    (Date.now() - new Date(dateStr).getTime()) / 3600000,
  );
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function extractOhlcv(
  collections: CollectionDataEntry[],
): OHLCV[] {
  const techCollection = collections.find((c) => c.source === "technical");
  if (!techCollection) return [];
  const data = techCollection.data as Record<string, unknown>;
  const ohlcv = data.ohlcv as OHLCV[] | undefined;
  return ohlcv ?? [];
}

function extractSupportResistance(analyses: AnalysisResult[]): {
  support: number | null;
  resistance: number | null;
} {
  const tech = analyses.find((a) => a.source === "technical");
  if (!tech) return { support: null, resistance: null };
  const details = tech.details as Record<string, unknown>;
  return {
    support: (details.support as number) ?? null,
    resistance: (details.resistance as number) ?? null,
  };
}

// --- Page Component ---

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

      if (reportResult.status === "fulfilled") {
        setReport(reportResult.value);
      }
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

  const ohlcv = extractOhlcv(collections);
  const { support, resistance } = extractSupportResistance(analyses);

  // Sort analyses by confidence descending
  const sortedAnalyses = [...analyses].sort(
    (a, b) => b.confidence - a.confidence,
  );

  // Map collection data by source for SourceCard
  const collectionMap = new Map<string, CollectionDataEntry>();
  for (const c of collections) {
    collectionMap.set(c.source, c);
  }

  return (
    <div className="space-y-6">
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
        </div>
        {report && (
          <span className="text-sm text-muted-foreground ml-auto">
            Updated {timeAgo(report.createdAt)}
          </span>
        )}
      </div>

      {/* Charts */}
      {ohlcv.length > 0 && (
        <Card>
          <CardContent className="py-4 px-2 space-y-2">
            <div className="flex items-center gap-4 px-2 mb-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-blue-500" /> SMA 50
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-orange-500" /> SMA
                200
              </span>
              {support != null && (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-0.5 bg-green-500 border-dashed" />{" "}
                  Support ${support.toFixed(2)}
                </span>
              )}
              {resistance != null && (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-0.5 bg-red-500 border-dashed" />{" "}
                  Resistance ${resistance.toFixed(2)}
                </span>
              )}
            </div>
            <PriceVolumeChart
              ohlcv={ohlcv}
              support={support}
              resistance={resistance}
            />
            <RsiChart ohlcv={ohlcv} />
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {report && (
        <Card>
          <CardContent className="py-4 px-4">
            <h2 className="text-sm font-semibold mb-2">Summary</h2>
            <p className="text-sm text-muted-foreground">{report.summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Full Report (markdown) */}
      {report?.fullReport && (
        <Card>
          <CardContent className="py-4 px-4">
            <h2 className="text-sm font-semibold mb-3">Full Report</h2>
            <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>
                {report.fullReport}
              </Markdown>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Source Cards */}
      {sortedAnalyses.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Signal Breakdown</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedAnalyses.map((a) => (
              <SourceCard
                key={a.id}
                analysis={a}
                collection={collectionMap.get(a.source)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Skipped Sources */}
      {skipped.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3 text-muted-foreground">
            Skipped Sources
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {skipped.map((s) => (
              <SkippedSourceCard key={s.source} status={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
