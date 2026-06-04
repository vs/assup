/**
 * Iron Condor Builder API
 */

import { request } from "./client";
import type {
  IronCondorOrderRequest,
  IronCondorOrderResponse,
  ActiveSpread,
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
};
