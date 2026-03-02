/**
 * Watchlists API
 */

import { request } from "./client";
import type { Watchlist, WatchlistWithItems, WatchlistItem } from "@assup/shared";

interface WatchlistCreateInput {
  name: string;
}

interface WatchlistItemCreateInput {
  symbol: string;
  conId?: number;
  secType?: string;
}

export const watchlistsApi = {
  list: () => request<Watchlist[]>("/api/watchlists"),

  get: (id: string) => request<WatchlistWithItems>(`/api/watchlists/${id}`),

  create: (data: WatchlistCreateInput) =>
    request<Watchlist>("/api/watchlists", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: WatchlistCreateInput) =>
    request<Watchlist>(`/api/watchlists/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/watchlists/${id}`, { method: "DELETE" }),

  addItem: (id: string, data: WatchlistItemCreateInput) =>
    request<WatchlistItem>(`/api/watchlists/${id}/items`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeItem: (id: string, itemId: string) =>
    request<void>(`/api/watchlists/${id}/items/${itemId}`, { method: "DELETE" }),
};
