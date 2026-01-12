/**
 * Scanner types for options opportunity discovery
 */

export interface ScannerCriteria {
  minDaysToExpiry: number;
  maxDaysToExpiry: number;
  minDelta: number;
  maxDelta: number;
  minAnnualizedReturn: number;
  minPremiumPercent: number;
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

export interface ScanResult {
  criteria: ScannerCriteria;
  targetAssetClasses: string[];
  symbolsScanned: string[];
  opportunities: unknown[];
  message?: string;
}

export interface UnderinvestedResult {
  underinvested: UnderinvestedClass[];
  totalPortfolioValue: number;
}
