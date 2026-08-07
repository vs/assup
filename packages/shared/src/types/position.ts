/**
 * Position types for portfolio holdings
 */

export type OptionRight = "C" | "P";
export type OptionsWeightMode = "notional" | "delta";

export interface Position {
  account: string;
  symbol: string;
  conId: number;
  secType: string;
  exchange: string;
  currency: string;
  position: number;
  avgCost: number;
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  // Option-specific fields
  strike?: number;
  expiry?: string;
  right?: OptionRight;
  underlying?: string;
  notionalValue?: number;
  deltaExposure?: number;
  /** Daily theta decay in $ (positive = earning from decay) */
  theta?: number;
  // Enriched data
  assetClassId: string | null;
  assetClassName: string | null;
  assetClassColor: string | null;
}

export interface AssetClassAllocation {
  id: string;
  name: string;
  color: string;
  value: number;
  stockValue: number;
  optionsNotional: number;
  optionsDelta: number;
  percentage: number;
}

export interface OptionsExposure {
  assetClassId: string;
  assetClassName: string;
  assetClassColor: string;
  putNotional: number;
  callNotional: number;
  putDelta: number;
  callDelta: number;
  netNotional: number;
  netDelta: number;
}

export interface AccountInfo {
  netLiquidation: number;
  cashValue: number;
  availableFunds?: number;
}

export interface PositionSummaryData {
  totalPositions: number;
  totalValue: number;
  totalStockValue: number;
  totalOptionsNotional: number;
  totalOptionsDelta: number;
  totalPutNotional: number;
  totalCallNotional: number;
  totalPutDelta: number;
  totalCallDelta: number;
  /** Portfolio-wide daily theta in $ (sum across all option positions) */
  totalTheta: number;
  unassignedValue: number;
  unassignedPercentage: number;
  includeOptions: boolean;
  optionsWeightMode: OptionsWeightMode;
  byAssetClass: AssetClassAllocation[];
  optionsExposure: OptionsExposure[];
}

export interface PositionSummary {
  positions: Position[];
  summary: PositionSummaryData;
  account: AccountInfo;
}

export interface PositionSummaryParams {
  includeOptions?: boolean;
  optionsWeightMode?: OptionsWeightMode;
}
