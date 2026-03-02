/**
 * Orders API
 */

import { request } from "./client";
import type { Order, OrderImpact, PlaceOrderInput, PlaceOrderResult, ModifyOrderResult, OptionQuoteResult } from "@assup/shared";

export interface SimulateOrderInput {
  symbol: string;
  secType?: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
}

export interface OptionQuoteInput {
  symbol: string;
  expiration: string; // YYYYMMDD
  strike: number;
  right: "C" | "P";
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

  quote: (input: OptionQuoteInput) =>
    request<OptionQuoteResult>("/api/orders/quote", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  modify: (orderId: number, params: { limitPrice: number; quantity: number }) =>
    request<ModifyOrderResult>(`/api/orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  cancel: (orderId: number) =>
    request<void>(`/api/orders/${orderId}`, {
      method: "DELETE",
    }),
};
