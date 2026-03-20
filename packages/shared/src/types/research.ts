// === Ticker ===

export interface ResearchTicker {
  id: string;
  symbol: string;
  secType: string;
  status: string;
  source: string;
  addedAt: string;
  lastAnalyzed: string | null;
}

// === Analysis ===

export type AnalysisSignal = "bullish" | "bearish" | "neutral";

export type AnalysisSource =
  | "seeking_alpha"
  | "technical"
  | "events"
  | "options"
  | "sec_filings"
  | "short_interest"
  | "social"
  | "analyst_consensus"
  | "macro";

export interface AnalysisResult {
  id: string;
  tickerId: string;
  source: AnalysisSource;
  analyzedAt: string;
  signal: AnalysisSignal;
  confidence: number;
  summary: string;
  details: Record<string, unknown>;
}

// === Report ===

export type Recommendation = "buy" | "sell" | "wheel" | "hold" | "avoid";

export interface ResearchReport {
  id: string;
  tickerId: string;
  symbol: string;
  createdAt: string;
  recommendation: Recommendation;
  confidence: number;
  summary: string;
  fullReport: string;
  analysisIds: string[];
}

// === Job ===

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface ResearchJob {
  id: string;
  type: string;
  symbol: string | null;
  status: JobStatus;
  progress: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// === Macro ===

export type MarketRegime = "risk_on" | "risk_off" | "neutral";

export interface MacroAnalysis {
  regime: MarketRegime;
  confidence: number;
  summary: string;
  analyzedAt: string;
  details: {
    vix: number | null;
    vixTrend: string;
    vixSma20: number | null;
    sp500Price: number | null;
    sp500Sma200: number | null;
    sp500Trend: string;
    putCallRatio: number | null;
    regime: MarketRegime;
  };
}

// === Screener ===

export interface ScreenerConfig {
  id: string;
  name: string;
  criteria: Record<string, unknown>;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
}

// === Collection Status ===

export interface CollectionStatus {
  source: string;
  status: "skipped";
  skipReason: string;
  collectedAt: string;
}

// === API Request/Response ===

export interface AddTickersRequest {
  symbols: string[];
  source?: string;
}

export interface TickerListResponse {
  tickers: ResearchTicker[];
  total: number;
}

export interface ReportHistoryResponse {
  reports: ResearchReport[];
  total: number;
}

export interface AnalysisSummaryResponse {
  symbol: string;
  analyses: AnalysisResult[];
  collectionStatuses: CollectionStatus[];
  lastUpdated: string | null;
}
