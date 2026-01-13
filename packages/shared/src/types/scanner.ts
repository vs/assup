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
