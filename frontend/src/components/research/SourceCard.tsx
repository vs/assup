import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { RawDataView } from "./RawDataView";
import type {
  AnalysisResult,
  AnalysisSignal,
  CollectionStatus,
  CollectionDataEntry,
} from "@assup/shared";

const SOURCE_LABELS: Record<string, string> = {
  technical: "Technical Analysis",
  options: "Options Flow",
  social: "Social Sentiment",
  sec_filings: "SEC Filings",
  seeking_alpha: "Seeking Alpha",
  short_interest: "Short Interest",
  events: "Events & Catalysts",
  macro: "Macro Context",
};

const SIGNAL_COLORS: Record<AnalysisSignal, { border: string; badge: string }> = {
  bullish: {
    border: "border-l-green-500",
    badge: "bg-green-500/15 text-green-700 border-green-500/20",
  },
  bearish: {
    border: "border-l-red-500",
    badge: "bg-red-500/15 text-red-700 border-red-500/20",
  },
  neutral: {
    border: "border-l-amber-500",
    badge: "bg-amber-500/15 text-amber-700 border-amber-500/20",
  },
};

interface SourceCardProps {
  analysis: AnalysisResult;
  collection?: CollectionDataEntry;
}

export function SourceCard({ analysis, collection }: SourceCardProps) {
  const [open, setOpen] = useState(false);
  const colors = SIGNAL_COLORS[analysis.signal];
  const label = SOURCE_LABELS[analysis.source] ?? analysis.source;

  return (
    <Card className={`border-l-4 ${colors.border}`}>
      <CardContent className="py-3 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{label}</span>
            <Badge
              variant="outline"
              className={`text-xs ${colors.badge}`}
            >
              {analysis.signal}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {Math.round(analysis.confidence * 100)}% confidence
          </span>
        </div>

        {/* Summary */}
        <p className="text-sm text-muted-foreground mb-2">
          {analysis.summary}
        </p>

        {/* Raw data collapsible */}
        {collection && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ChevronDown
                className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
              />
              Raw data
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 bg-muted/50 rounded-md p-2">
                <RawDataView collection={collection} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

// --- Skipped Source Card ---

interface SkippedSourceCardProps {
  status: CollectionStatus;
}

export function SkippedSourceCard({ status }: SkippedSourceCardProps) {
  const label = SOURCE_LABELS[status.source] ?? status.source;

  return (
    <Card className="border-l-4 border-l-gray-300 opacity-60">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{label}</span>
            <Badge variant="outline" className="text-xs">
              skipped
            </Badge>
          </div>
        </div>
        {status.skipReason && (
          <p className="text-sm text-muted-foreground mt-1">
            {status.skipReason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
