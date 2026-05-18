import type { Recommendation } from "./research.js";

// === Strategy Config ===

export interface WheelStrategy {
  id: string;
  name: string;
  enabled: boolean;
  minMarketCap: number;
  cspMinDte: number;
  cspMaxDte: number;
  cspMaxDelta: number;
  cspMinRoi: number;
  cspMaxRoi: number;
  ccMinDte: number;
  ccMaxDte: number;
  ccMinRoi: number | null;
  maxPositions: number;
  maxPerAssetClass: number;
  targetAssetClasses: string[];
  acceptedRecommendations: Recommendation[];
  minResearchConfidence: number | null;
  requireFreshReport: boolean;
  reportMaxAgeDays: number;
  intervalHours: number | null;
  cronExpression: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WheelStrategyInput {
  name: string;
  enabled?: boolean;
  minMarketCap?: number;
  cspMinDte?: number;
  cspMaxDte?: number;
  cspMaxDelta?: number;
  cspMinRoi?: number;
  cspMaxRoi?: number;
  ccMinDte?: number;
  ccMaxDte?: number;
  ccMinRoi?: number | null;
  maxPositions?: number;
  maxPerAssetClass?: number;
  targetAssetClasses?: string[];
  acceptedRecommendations?: Recommendation[];
  minResearchConfidence?: number | null;
  requireFreshReport?: boolean;
  reportMaxAgeDays?: number;
  intervalHours?: number | null;
  cronExpression?: string | null;
}

// === Scan Results ===

export interface WheelStrategyScan {
  id: string;
  strategyId: string;
  status: "pending" | "running" | "completed" | "failed";
  phase: string | null;
  totalCandidates: number;
  processedCandidates: number;
  cspResults: CspResultItem[] | null;
  ccResults: CcResultItem[] | null;
  skippedTickers: SkippedTicker[] | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface CspResultItem {
  symbol: string;
  assetClassId: string;
  assetClassName: string;
  researchRecommendation: Recommendation;
  researchConfidence: number;
  earningsDate: string | null;
  contract: StrategyContract;
  compositeScore: number;
  allocationNeed: number;
  marketCap: number;
  lastPrice: number;
}

export interface CcResultItem {
  symbol: string;
  assetClassId: string;
  assetClassName: string;
  currentPrice: number;
  costBasis: number;
  sharesHeld: number;
  contract: StrategyContract;
}

export interface StrategyContract {
  strike: number;
  expiration: string;
  daysToExpiry: number;
  delta: number | null;
  bid: number;
  ask: number;
  midPrice: number;
  premiumPercent: number;
  annualizedReturn: number;
}

export interface SkippedTicker {
  symbol: string;
  reason: string;
}

// === SSE Progress ===

export interface WheelStrategyProgress {
  scanId: string;
  phase: "discovery" | "fundamentals" | "earnings" | "contracts" | "ranking" | "completed";
  current: number;
  total: number;
  cspCount?: number;
  ccCount?: number;
}

// === Execute Order ===

export interface WheelStrategyExecuteInput {
  type: "csp" | "cc";
  symbol: string;
  strike: number;
  expiration: string;
  quantity: number;
  limitPrice: number;
}
