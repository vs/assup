import { z } from "zod";

export const addTickersSchema = z.object({
  symbols: z
    .array(z.string().min(1).max(20).toUpperCase())
    .min(1)
    .max(100),
  source: z.enum(["manual", "external", "screener", "wheel_scanner"]).default("manual"),
});

export const tickerParamsSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
});

export const updateTickerSchema = z.object({
  status: z.enum(["active", "paused", "removed"]),
});

export const tickerListQuerySchema = z.object({
  status: z.enum(["active", "paused", "removed"]).optional(),
  source: z.enum(["manual", "external", "screener", "wheel_scanner"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
