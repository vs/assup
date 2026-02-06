/**
 * Scanner types for options opportunity discovery
 */

export type OptionTypeFilter = "PUT" | "CALL" | "BOTH";

export interface ScannerCriteria {
  optionTypes: OptionTypeFilter;
  minDaysToExpiry: number;
  maxDaysToExpiry: number;
  minDelta: number;
  maxDelta: number;
  minAnnualizedReturn: number;
  minPremiumPercent: number;
  // PUT strike range (% of underlying price)
  putMinStrikePercent: number;
  putMaxStrikePercent: number;
  // CALL strike range (% of underlying price)
  callMinStrikePercent: number;
  callMaxStrikePercent: number;
  specificSymbol?: string;
  targetAssetClasses?: string[];
}

export interface ScannerPreset {
  id: string;
  name: string;
  criteria: ScannerCriteria;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnderinvestedClass {
  id: string;
  name: string;
  color: string;
  targetPercentage: number;
  currentPercentage: number;
  difference: number;
  currentValue: number;
  targetValue: number;
  shortfall: number;
}

export interface OptionOpportunity {
  symbol: string;
  assetClassName: string;
  assetClassColor: string;
  strike: number;
  expiration: string;
  daysToExpiry: number;
  optionType: "CALL" | "PUT";
  bid: number;
  ask: number;
  midPrice: number;
  delta?: number;
  annualizedReturn: number;
  premiumPercent: number;
  underlyingPrice?: number;
}

export interface ScanResult {
  criteria: ScannerCriteria;
  targetAssetClasses: string[];
  symbolsScanned: string[];
  opportunities: OptionOpportunity[];
  message?: string;
}

export interface UnderinvestedResult {
  underinvested: UnderinvestedClass[];
  totalPortfolioValue: number;
}

export type ScanJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface ScanJob {
  id: string;
  presetId: string | null;
  presetName: string;
  criteria: ScannerCriteria;
  status: ScanJobStatus;
  totalSymbols: number;
  scannedSymbols: number;
  opportunityCount: number;
  bestAnnualReturn: number | null;
  bestPremiumPct: number | null;
  opportunities: OptionOpportunity[];
  startedAt: string;
  completedAt: string | null;
  expiresAt: string;
  errorMessage: string | null;
}

export interface ScanJobCreateInput {
  presetId?: string;
  criteria: ScannerCriteria;
}

export interface ScanJobProgress {
  jobId: string;
  scannedSymbols: number;
  totalSymbols: number;
  opportunityCount: number;
  symbol?: string;
  assetClass?: string;
}
