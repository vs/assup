export interface WheelScanConfig {
  id: string;
  assetClassId: string;
  assetClass?: { id: string; name: string; color: string };
  searchKeywords: string[];
  seedTickers: string[];
  minPrice: number;
  maxPrice: number;
  minMarketCap: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WheelScanResult {
  id: string;
  scanId: string;
  symbol: string;
  assetClassId: string;
  source: "seed" | "discovery";
  compositeScore: number;
  ivRank: number | null;
  putLiquidity: number | null;
  premiumYield: number | null;
  marketCap: number | null;
  lastPrice: number | null;
  allocationNeed: number | null;
  reportTriggered: boolean;
  createdAt: string;
}

export type WheelScanStatus = "pending" | "running" | "completed" | "failed";

export interface WheelScan {
  id: string;
  status: WheelScanStatus;
  totalCandidates: number;
  scoredCandidates: number;
  reportsTriggered: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  results: WheelScanResult[];
}

export interface WheelScanProgress {
  scanId: string;
  phase: "discovery" | "scoring" | "reports";
  current: number;
  total: number;
}
