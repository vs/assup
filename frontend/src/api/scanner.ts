/**
 * Scanner API
 */

import { request } from "./client";
import type { ScannerPreset, ScannerCriteria, ScanResult, UnderinvestedClass } from "@assup/shared";

export interface ScannerPresetCreateInput {
  name: string;
  criteria: ScannerCriteria;
  isDefault?: boolean;
}

export interface ScannerPresetUpdateInput {
  name?: string;
  criteria?: ScannerCriteria;
  isDefault?: boolean;
}

export const scannerApi = {
  presets: {
    list: () => request<ScannerPreset[]>("/api/scanner/presets"),

    get: (id: string) => request<ScannerPreset>(`/api/scanner/presets/${id}`),

    create: (data: ScannerPresetCreateInput) =>
      request<ScannerPreset>("/api/scanner/presets", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    update: (id: string, data: ScannerPresetUpdateInput) =>
      request<ScannerPreset>(`/api/scanner/presets/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    delete: (id: string) =>
      request<void>(`/api/scanner/presets/${id}`, { method: "DELETE" }),
  },

  scan: (criteria: ScannerCriteria) =>
    request<ScanResult>("/api/scanner/scan", {
      method: "POST",
      body: JSON.stringify(criteria),
    }),

  underinvested: () =>
    request<{ underinvested: UnderinvestedClass[]; totalPortfolioValue: number }>(
      "/api/scanner/underinvested"
    ),
};
