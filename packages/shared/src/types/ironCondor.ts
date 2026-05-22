/**
 * Iron Condor Builder types
 */

export interface IronCondorChainOption {
  conId: number;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  delta: number;
  iv: number;
}

export interface IronCondorChainStrike {
  strike: number;
  put: IronCondorChainOption | null;
  call: IronCondorChainOption | null;
}

export interface IronCondorChainResponse {
  underlyingPrice: number;
  expirations: string[];
  selectedExpiration: string;
  chain: IronCondorChainStrike[];
}

export type IronCondorLegType = "PUT" | "CALL";
export type IronCondorLegSide = "BUY" | "SELL";

export interface IronCondorLeg {
  strike: number;
  type: IronCondorLegType;
  side: IronCondorLegSide;
  iv: number;
  bid: number;
  ask: number;
}

export interface IronCondorAnalyzeRequest {
  underlyingPrice: number;
  legs: IronCondorLeg[];
  daysToExpiry: number;
  quantity: number;
}

export interface IronCondorAnalyzeResponse {
  netCredit: { bid: number; ask: number; mid: number };
  maxProfit: number;
  maxLossPut: number;
  maxLossCall: number;
  breakEvenLow: number;
  breakEvenHigh: number;
  breakEvenLowPercent: number;
  breakEvenHighPercent: number;
  probabilityOfProfit: number;
  probabilityOfMaxLossPut: number;
  probabilityOfMaxLossCall: number;
  expectedValue: number;
  riskRewardRatio: number;
  payoffCurve: Array<{ price: number; pnl: number }>;
}

export interface IronCondorOrderLeg {
  conId: number;
  strike: number;
  type: IronCondorLegType;
  side: IronCondorLegSide;
  expiration: string;
  exchange: string;
}

export interface IronCondorOrderRequest {
  symbol: string;
  legs: IronCondorOrderLeg[];
  quantity: number;
  limitPrice: number;
}

export interface IronCondorOrderResponse {
  orderId: number;
  status: string;
}

/** Client-side state for selected iron condor legs */
export interface IronCondorSelectedLegs {
  buyPut: number | null;
  sellPut: number | null;
  sellCall: number | null;
  buyCall: number | null;
}
