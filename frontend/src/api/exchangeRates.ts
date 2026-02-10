/**
 * Exchange Rates API client
 */

import { request } from "./client";
import type { ExchangeRateStatus } from "@assup/shared";

interface ExchangeRateEntry {
  date: string;
  currency: string;
  rate: number;
}

interface FetchResult {
  message: string;
  fetched: number;
  skipped: number;
}

export const exchangeRatesApi = {
  getRates: (year: number) =>
    request<ExchangeRateEntry[]>(`/api/exchange-rates/${year}`),

  getStatus: (year: number) =>
    request<ExchangeRateStatus>(`/api/exchange-rates/${year}/status`),

  fetchRates: (startDate: string, endDate: string, currencies?: string[]) =>
    request<FetchResult>("/api/exchange-rates/fetch", {
      method: "POST",
      body: JSON.stringify({ startDate, endDate, currencies }),
    }),
};
