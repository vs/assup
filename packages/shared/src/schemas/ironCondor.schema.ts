/**
 * Zod schemas for Iron Condor Builder validation
 */

import { z } from "zod";

const orderLegSchema = z.object({
  conId: z.number().int().positive("conId is required"),
  strike: z.number().positive(),
  type: z.enum(["PUT", "CALL"]),
  side: z.enum(["BUY", "SELL"]),
  expiration: z.string().length(8, "Expiration must be YYYYMMDD format"),
  exchange: z.string().min(1).default("SMART"),
});

export const ironCondorOrderSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  legs: z.array(orderLegSchema).min(2).max(4),
  quantity: z.number().int().positive("Quantity must be positive"),
  limitPrice: z.number().refine(v => v !== 0, "Limit price must not be zero"),
});

export type IronCondorOrderInput = z.infer<typeof ironCondorOrderSchema>;

export const closeSpreadOrderSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  legs: z.array(orderLegSchema).min(2).max(4),
  quantity: z.number().int().positive("Quantity must be positive"),
  limitPrice: z.number().min(0, "Limit price must be non-negative"),
});

export type CloseSpreadOrderInput = z.infer<typeof closeSpreadOrderSchema>;

export const singleOrderSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  conId: z.number().int().positive("conId is required"),
  expiration: z.string().length(8, "Expiration must be YYYYMMDD format"),
  strike: z.number().positive("Strike must be positive"),
  right: z.enum(["C", "P"]),
  action: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive("Quantity must be positive"),
  limitPrice: z.number().positive("Limit price must be positive"),
});

export type SingleOrderInput = z.infer<typeof singleOrderSchema>;
