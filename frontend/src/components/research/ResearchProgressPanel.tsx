import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Recommendation,
  ResearchJobDetail,
  ResearchSourceProgress,
} from "@assup/shared";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  TrendingDown,
  TrendingUp,
  Minus,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RecommendationBadge } from "@/components/common";

const SOURCE_LABELS: Record<string, string> = {
  technical: "Technical",
  events: "Events",
  options: "Options",
  sec_filings: "SEC filings",
  social: "Social",
  sa_comments: "SA comments",
  fundamentals: "Fundamentals",
  macro: "Macro",
};

const RECOMMENDATIONS = new Set<string>(["buy", "sell", "wheel", "hold", "avoid"]);
const FINISHED = new Set<ResearchSourceProgress["status"]>(["done", "skipped", "failed"]);

/** Re-render every second while `active`, returning the current time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function seconds(fromIso: string | null | undefined, toMs: number): string | null {
  if (!fromIso) return null;
  const s = Math.max(0, Math.round((toMs - new Date(fromIso).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function StatusIcon({ status, stale }: { status: ResearchSourceProgress["status"]; stale: boolean }) {
  switch (status) {
    case "collecting":
    case "analyzing":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
    case "done":
      return <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${stale ? "text-amber-600" : "text-green-600"}`} />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />;
    case "skipped":
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />;
  }
}

function SignalMark({ signal }: { signal: string }) {
  if (signal === "bullish" || signal === "risk_on")
    return <TrendingUp className="h-3.5 w-3.5 text-green-600 shrink-0" />;
  if (signal === "bearish" || signal === "risk_off")
    return <TrendingDown className="h-3.5 w-3.5 text-red-600 shrink-0" />;
  return <Minus className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
}

function SourceRow({ s, now }: { s: ResearchSourceProgress; now: number }) {
  const running = s.status === "collecting" || s.status === "analyzing";
  // A finished source with a detail fell back to earlier data (fetch failed or was skipped)
  const stale = s.status === "done" && !!s.detail;
  const elapsed = running
    ? seconds(s.startedAt, now)
    : s.finishedAt && s.startedAt
      ? seconds(s.startedAt, new Date(s.finishedAt).getTime())
      : null;

  const row = (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm bg-muted/40">
      <StatusIcon status={s.status} stale={stale} />
      <span className={s.status === "pending" ? "text-muted-foreground" : ""}>
        {SOURCE_LABELS[s.source] ?? s.source.replace(/_/g, " ")}
      </span>
      {s.status === "analyzing" && (
        <span className="text-xs text-muted-foreground">analyzing</span>
      )}
      {s.cached && s.status === "done" && (
        <span className="text-xs text-muted-foreground">cached</span>
      )}
      {stale && <span className="text-xs text-amber-600">earlier data</span>}
      <span className="flex-1" />
      {s.status === "done" && s.signal && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <SignalMark signal={s.signal} />
          {s.confidence != null && `${Math.round(s.confidence * 100)}%`}
        </span>
      )}
      {(s.status === "skipped" || s.status === "failed") && (
        <span className="text-xs text-muted-foreground">{s.status}</span>
      )}
      {elapsed && (
        <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">{elapsed}</span>
      )}
    </div>
  );

  if (!s.detail) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{s.detail}</TooltipContent>
    </Tooltip>
  );
}

function Step({ label, state }: { label: string; state: "todo" | "active" | "done" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        state === "todo" ? "text-muted-foreground" : ""
      }`}
    >
      {state === "done" ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
      ) : state === "active" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      ) : (
        <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
      )}
      {label}
    </span>
  );
}

interface ResearchProgressPanelProps {
  detail: ResearchJobDetail | null;
}

/**
 * Live view of a report being generated: each data source as it is
 * collected and analyzed, then the report text as the AI writes it.
 */
export function ResearchProgressPanel({ detail }: ResearchProgressPanelProps) {
  const now = useNow(true);
  const sources = detail?.sources ?? [];
  const finished = sources.filter((s) => FINISHED.has(s.status)).length;
  const stage = detail?.stage ?? "collecting";
  const preview = detail?.preview;
  const recommendation =
    preview?.recommendation && RECOMMENDATIONS.has(preview.recommendation)
      ? (preview.recommendation as Recommendation)
      : null;
  const writtenChars = (preview?.summary?.length ?? 0) + (preview?.fullReport?.length ?? 0);

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="border-primary/30">
        <CardContent className="py-3 px-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Generating report
            </h2>
            <Step
              label={`Collect data${sources.length ? ` ${finished}/${sources.length}` : ""}`}
              state={stage === "collecting" ? "active" : "done"}
            />
            <Step
              label={stage === "synthesizing" && writtenChars > 0
                ? `Write report · ${(writtenChars / 1000).toFixed(1)}k chars`
                : "Write report"}
              state={stage === "collecting" ? "todo" : stage === "synthesizing" ? "active" : "done"}
            />
            <Step label="Save" state={stage === "storing" ? "active" : "todo"} />
            <span className="flex-1" />
            {detail?.startedAt && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {seconds(detail.startedAt, now)}
              </span>
            )}
          </div>

          {stage === "collecting" && sources.length > 0 && (
            <Progress value={(finished / sources.length) * 100} className="h-1" />
          )}

          {sources.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
              {sources.map((s) => (
                <SourceRow key={s.source} s={s} now={now} />
              ))}
            </div>
          )}

          {stage !== "collecting" && (
            <div className="space-y-2 border-t pt-3">
              {!preview?.summary && !preview?.fullReport && (
                <p className="text-sm text-muted-foreground">
                  Waiting for the AI to start writing
                  {detail?.synthesisStartedAt && ` · ${seconds(detail.synthesisStartedAt, now)}`}…
                </p>
              )}
              {(recommendation || preview?.summary) && (
                <div className="flex items-start gap-2">
                  {recommendation && (
                    <RecommendationBadge
                      recommendation={recommendation}
                      confidence={preview?.confidence ?? undefined}
                    />
                  )}
                  {preview?.summary && <p className="text-sm">{preview.summary}</p>}
                </div>
              )}
              {preview?.fullReport && (
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none max-h-96 overflow-y-auto">
                  <Markdown remarkPlugins={[remarkGfm]}>{preview.fullReport}</Markdown>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
