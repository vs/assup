/**
 * Wheel Strategy API
 */

import { request } from "./client";
import type {
  WheelListResponse,
  WheelTickerDetail,
  WheelTracker,
  WheelSuggestionsResponse,
} from "@assup/shared";

export const wheelApi = {
  /**
   * Get all tracked tickers with metrics
   */
  list: (options?: { includeSuggestions?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.includeSuggestions === false) {
      params.set("includeSuggestions", "false");
    }
    const suffix = params.toString();
    return request<WheelListResponse>(`/api/wheel${suffix ? `?${suffix}` : ""}`);
  },

  /**
   * Get suggestions for new tickers to track
   */
  suggestions: () => request<WheelSuggestionsResponse>("/api/wheel/suggestions"),

  /**
   * Get detailed view for a single ticker
   */
  detail: (symbol: string) =>
    request<WheelTickerDetail>(`/api/wheel/${encodeURIComponent(symbol)}`),

  /**
   * Add a ticker to tracking
   */
  add: (symbol: string, startDate?: string) =>
    request<WheelTracker>("/api/wheel", {
      method: "POST",
      body: JSON.stringify({ symbol, startDate }),
    }),

  /**
   * Remove a ticker from tracking
   */
  remove: (symbol: string) =>
    request<void>(`/api/wheel/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),

  /**
   * Dismiss a suggestion
   */
  dismissSuggestion: (symbol: string) =>
    request<void>(`/api/wheel/suggestions/${encodeURIComponent(symbol)}/dismiss`, {
      method: "POST",
    }),
};
