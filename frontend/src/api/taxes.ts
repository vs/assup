/**
 * Taxes API client
 */

import { request } from "./client";
import { getApiBase } from "@/lib/apiConfig";
import type {
  TaxSummary,
  TaxStockTradesResponse,
  TaxOptionTradesResponse,
  TaxDividendsResponse,
  TaxInterestResponse,
  LotTraceResponse,
  OptionLotTraceResponse,
} from "@assup/shared";

export const taxesApi = {
  summary: (year: number) =>
    request<TaxSummary>(`/api/taxes/summary/${year}`),

  stockTrades: (year: number) =>
    request<TaxStockTradesResponse>(`/api/taxes/stock-trades/${year}`),

  optionTrades: (year: number) =>
    request<TaxOptionTradesResponse>(`/api/taxes/option-trades/${year}`),

  dividends: (year: number) =>
    request<TaxDividendsResponse>(`/api/taxes/dividends/${year}`),

  interest: (year: number) =>
    request<TaxInterestResponse>(`/api/taxes/interest/${year}`),

  lotTrace: (symbol: string) =>
    request<LotTraceResponse>(
      `/api/taxes/lot-trace/${encodeURIComponent(symbol)}`
    ),

  optionLotTrace: (symbol: string) =>
    request<OptionLotTraceResponse>(
      `/api/taxes/option-lot-trace/${encodeURIComponent(symbol)}`
    ),

  export: (year: number) => {
    // Direct download - opens in new tab/downloads file
    window.location.href = `${getApiBase()}/api/taxes/export/${year}`;
  },
};
