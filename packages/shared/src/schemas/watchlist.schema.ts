/**
 * Zod schemas for watchlist validation
 */

import { z } from "zod";

export const watchlistCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
});

export const watchlistUpdateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

export const watchlistIdParamSchema = z.object({
  id: z.string().uuid("Invalid watchlist ID"),
});

export const watchlistItemCreateSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20).transform((s) => s.toUpperCase()),
  conId: z.number().int().positive().optional(),
  secType: z.string().min(1).max(10).optional().default("STK"),
});

export const watchlistItemIdParamSchema = z.object({
  id: z.string().uuid("Invalid watchlist ID"),
  itemId: z.string().uuid("Invalid item ID"),
});

export type WatchlistCreateInput = z.infer<typeof watchlistCreateSchema>;
export type WatchlistUpdateInput = z.infer<typeof watchlistUpdateSchema>;
export type WatchlistItemCreateInput = z.infer<typeof watchlistItemCreateSchema>;
