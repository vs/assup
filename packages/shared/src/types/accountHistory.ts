export interface AccountSnapshotPoint {
  date: string;
  netLiquidation: number;
}

export interface FundFlowPoint {
  date: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  amount: number;
  currency: string;
  description: string;
}

export interface AccountHistoryResponse {
  snapshots: AccountSnapshotPoint[];
  fundFlows: FundFlowPoint[];
}

export type AccountHistoryGranularity = "daily" | "weekly" | "monthly";
