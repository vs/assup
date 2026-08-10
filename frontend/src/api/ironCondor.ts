/**
 * Iron Condor Builder API
 */

import { request } from "./client";
import type {
  IronCondorOrderRequest,
  IronCondorOrderResponse,
  ActiveSpread,
  SingleOrderRequest,
  SingleOrderResponse,
} from "@assup/shared";

export const ironCondorApi = {
  placeOrder: (data: IronCondorOrderRequest) =>
    request<IronCondorOrderResponse>("/api/iron-condor/order", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  closeSpread: (data: IronCondorOrderRequest) =>
    request<IronCondorOrderResponse>("/api/spreads/close", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getActiveSpreads: () =>
    request<{ spreads: ActiveSpread[] }>("/api/spreads/positions"),

  getExpirations: (symbol: string) =>
    request<{ expirations: string[] }>(`/api/spreads/expirations?symbol=${encodeURIComponent(symbol)}`),

  placeSingleOrder: (data: SingleOrderRequest): Promise<SingleOrderResponse> =>
    request("/api/iron-condor/single-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
};
