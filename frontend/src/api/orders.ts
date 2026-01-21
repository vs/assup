/**
 * Orders API
 */

import { request } from "./client";
import type { Order, OrderImpact, PlaceOrderInput, PlaceOrderResult } from "@assup/shared";

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

  place: (order: PlaceOrderInput) =>
    request<PlaceOrderResult>("/api/orders/place", {
      method: "POST",
      body: JSON.stringify(order),
    }),
};
