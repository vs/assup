/**
 * Iron Condor Builder API
 */

import { request, buildQuery } from "./client";
import type {
  IronCondorChainResponse,
  IronCondorAnalyzeRequest,
  IronCondorAnalyzeResponse,
  IronCondorOrderRequest,
  IronCondorOrderResponse,
  ActiveSpread,
} from "@assup/shared";

export const ironCondorApi = {
  getChain: (symbol: string, dte?: number) =>
    request<IronCondorChainResponse>(
      `/api/iron-condor/chain${buildQuery({ symbol, dte })}`,
    ),

  analyze: (data: IronCondorAnalyzeRequest) =>
    request<IronCondorAnalyzeResponse>("/api/iron-condor/analyze", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  placeOrder: (data: IronCondorOrderRequest) =>
    request<IronCondorOrderResponse>("/api/iron-condor/order", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getActiveSpreads: () =>
    request<ActiveSpread[]>("/api/spreads/active"),

  closeSpread: (data: IronCondorOrderRequest) =>
    request<IronCondorOrderResponse>("/api/spreads/close", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
