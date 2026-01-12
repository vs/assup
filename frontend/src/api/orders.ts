/**
 * Orders API
 */

import { request } from "./client";
import type { Order, OrderImpact } from "@assup/shared";

export interface SimulateOrderInput {
  symbol: string;
  secType?: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
}

export const ordersApi = {
  list: () => request<Order[]>("/api/orders"),

  impact: () => request<OrderImpact>("/api/orders/impact"),

  simulate: (orders: SimulateOrderInput[]) =>
    request<OrderImpact>("/api/orders/simulate", {
      method: "POST",
      body: JSON.stringify({ orders }),
    }),
};
