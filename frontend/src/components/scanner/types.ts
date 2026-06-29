import type { OptionOpportunity } from "@assup/shared";

// Extended opportunity with underlyingPrice (returned by backend but not in shared types)
export interface ExtendedOptionOpportunity extends OptionOpportunity {
  underlyingPrice?: number;
}

export interface DTEGroupSummary {
  count: number;
  bestAnnualReturn: number;
  bestPremiumPercent: number;
}

export interface DTEGroup {
  dte: number;
  expiration: string;
  opportunities: ExtendedOptionOpportunity[];
  summary: DTEGroupSummary;
}

export interface TickerGroupSummary {
  totalCount: number;
  bestAnnualReturn: number;
  bestPremiumPercent: number;
  uniqueExpirations: number;
}

export interface TickerGroup {
  symbol: string;
  underlyingPrice: number | null;
  assetClassName: string;
  assetClassColor: string;
  dteGroups: DTEGroup[];
  summary: TickerGroupSummary;
  /** Number of shares held */
  shares: number | null;
  /** IBKR position average cost per share */
  avgCost: number | null;
  /** Wheel-adjusted cost basis (reduced by cycle premiums) */
  wheelCostBasis: number | null;
}
