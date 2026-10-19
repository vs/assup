import type {
  ResearchJobDetail,
  ResearchJobStage,
  ResearchReportPreview,
  ResearchSourceProgress,
} from "@assup/shared";
import type { SourceProgressEvent } from "./collection.service.js";
import { parsePartialReport } from "./synthesizer/partialReport.js";

/** Minimum gap between streamed preview updates. */
const PREVIEW_INTERVAL_MS = 500;

const TERMINAL = new Set<ResearchSourceProgress["status"]>(["done", "skipped", "failed"]);

type Publish = (progress: string, detail: ResearchJobDetail) => Promise<unknown>;

/**
 * Tracks one report generation and publishes its progress: each source's
 * state while collection runs, then the report text as it streams from the
 * synthesizer. Updates are sent strictly in order through a single queue so
 * callers can fire them without awaiting; a failed publish is logged and
 * the next update carries the full state anyway.
 */
export class ReportProgress {
  private readonly sources: ResearchSourceProgress[];
  private readonly startedAt = new Date().toISOString();
  private stage: ResearchJobStage = "collecting";
  private synthesisStartedAt: string | null = null;
  private preview: ResearchReportPreview | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastPreviewAt = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(sourceNames: string[], private readonly publish: Publish) {
    this.sources = sourceNames.map((source) => ({ source, status: "pending" }));
  }

  begin(): Promise<void> {
    this.send();
    return this.flush();
  }

  source(event: SourceProgressEvent): void {
    const entry = this.sources.find((s) => s.source === event.source);
    if (!entry) return;
    const now = new Date().toISOString();
    Object.assign(entry, event);
    if (event.status === "collecting" && !entry.startedAt) entry.startedAt = now;
    if (TERMINAL.has(event.status)) entry.finishedAt = now;
    this.send();
  }

  synthesizing(): Promise<void> {
    this.stage = "synthesizing";
    this.synthesisStartedAt = new Date().toISOString();
    this.send();
    return this.flush();
  }

  /** Feed the synthesizer's response text so far; sent at most every PREVIEW_INTERVAL_MS. */
  partialText(text: string): void {
    this.preview = parsePartialReport(text);
    if (this.previewTimer) return;
    const wait = this.lastPreviewAt + PREVIEW_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.sendPreview();
    } else {
      this.previewTimer = setTimeout(() => this.sendPreview(), wait);
    }
  }

  storing(): Promise<void> {
    this.cancelPreviewTimer();
    this.stage = "storing";
    this.send();
    return this.flush();
  }

  /** Resolves once every update queued so far has been published. */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Stop pending timers (the job ended). */
  dispose(): void {
    this.cancelPreviewTimer();
  }

  private sendPreview(): void {
    this.previewTimer = null;
    this.lastPreviewAt = Date.now();
    this.send();
  }

  private cancelPreviewTimer(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }

  private send(): void {
    const progress = this.summary();
    const detail: ResearchJobDetail = structuredClone({
      stage: this.stage,
      startedAt: this.startedAt,
      sources: this.sources,
      synthesisStartedAt: this.synthesisStartedAt,
      preview: this.preview,
    });
    this.queue = this.queue
      .then(() => this.publish(progress, detail))
      .then(
        () => {},
        (err) => console.warn(`[ReportProgress] Failed to publish progress: ${(err as Error).message}`)
      );
  }

  private summary(): string {
    if (this.stage === "synthesizing") return "Writing report…";
    if (this.stage === "storing") return "Saving report…";
    const finished = this.sources.filter((s) => TERMINAL.has(s.status)).length;
    return `Collecting ${finished}/${this.sources.length}`;
  }
}
