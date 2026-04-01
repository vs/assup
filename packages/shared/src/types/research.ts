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
    vixChange: number | null;
    vixTrend: string;
    vixSma20: number | null;
    sp500Index: number | null;
    sp500Sma200: number | null;
    sp500Trend: string;
    sp500Rsi: number | null;
    sp500Change: number | null;
    hygChange: number | null;
    tltChange: number | null;
    safeHavenSpread: number | null;
    putCallRatio: number | null;
    regime: MarketRegime;
  };
}

// === Market Scanner ===

export interface TechnicalFilterConfig {
  enabled: boolean;
  trendPeriodYears?: number;
  minSma200SlopeMonths?: number;
  maxRsi?: number;
  requireAboveSma200?: boolean;
  require50Above200?: boolean;
}

export interface MarketScannerPreset {
  id: string;
  name: string;
  scanCode: string;
  locationCode: string;
  filters: Record<string, unknown>;
  technicalFilter: TechnicalFilterConfig;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
}

export interface ScanCodeInfo {
  code: string;
  label: string;
  description: string;
}

export interface TechnicalScore {
  symbol: string;
  passed: boolean;
  score: number;
  details: {
    aboveSma200: boolean;
    sma200SlopePositive: boolean;
    sma50Above200: boolean;
    rsi14: number | null;
    currentPrice: number | null;
    sma200: number | null;
    sma50: number | null;
  };
}

export interface ScannerResultItem {
  rank: number;
  symbol: string;
  conId: number;
  exchange: string;
  secType: string;
  longName?: string;
  industry?: string;
  category?: string;
  technical?: TechnicalScore;
}

export interface MarketScanResult {
  discovered: ScannerResultItem[];
  scored: ScannerResultItem[];
  qualified: string[];
  added: string[];
  skipped: string[];
  reportsQueued: number;
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

// === Collection Data ===

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CollectionDataEntry {
  source: string;
  data: Record<string, unknown>;
  collectedAt: string;
}

export interface CollectionDataResponse {
  symbol: string;
  collections: CollectionDataEntry[];
}
