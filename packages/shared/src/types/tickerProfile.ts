// packages/shared/src/types/tickerProfile.ts

import type { Recommendation } from "./research.js";

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
  chart: { date: string; close: number }[];
  recommendation: Recommendation | null;
  confidence: number | null;
}

export type TickerProfileBatchResponse = Record<string, TickerProfileResponse>;
