// packages/shared/src/types/tickerProfile.ts

import type { Recommendation } from "./research.js";

export type IvRankUnavailableReason =
  | "tws_disconnected"
  | "no_iv_data"
  | "insufficient_history"
  | "degenerate_range";

export interface IvRankInfo {
  /** 0–100: position of today's ATM IV within its 52-week range. */
  ivRank: number;
  /** Decimal, e.g. 0.341 = 34.1%. */
  currentIv: number;
  iv52wLow: number;
  iv52wHigh: number;
  /** Bars actually used; 252 when a full year is available, 126–251 otherwise. */
  windowDays: number;
  /** Date of the last bar in the window. */
  asOf: string;
}

export interface TickerProfileResponse {
  symbol: string;
  companyName: string;
  description: string;
  sector: string | null;
  industry: string | null;
  marketPosition: string | null;
  marketCap: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  currentPrice: number | null;
  previousClose: number | null;
  chart: { date: string; close: number }[];
  recommendation: Recommendation | null;
  confidence: number | null;
  ivRank: IvRankInfo | null;
  /** Non-null exactly when `ivRank` is null. */
  ivRankUnavailableReason: IvRankUnavailableReason | null;
}

export type TickerProfileBatchResponse = Record<string, TickerProfileResponse>;

export interface TickerQuoteResponse {
  symbol: string;
  last: number | null;
  open: number | null;
  close: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
}
