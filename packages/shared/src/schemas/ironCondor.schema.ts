/**
 * Zod schemas for Iron Condor Builder validation
 */

import { z } from "zod";

export const ironCondorChainQuerySchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase().default("SPX"),
  dte: z.coerce.number().int().min(0).max(365).optional().default(1),
});

export type IronCondorChainQueryInput = z.infer<typeof ironCondorChainQuerySchema>;

const legSchema = z.object({
  strike: z.number().positive("Strike must be positive"),
  type: z.enum(["PUT", "CALL"]),
  side: z.enum(["BUY", "SELL"]),
  iv: z.number().min(0, "IV must be non-negative"),
  bid: z.number().min(0),
  ask: z.number().min(0),
});

export const ironCondorAnalyzeSchema = z.object({
  underlyingPrice: z.number().positive("Underlying price must be positive"),
  legs: z.array(legSchema).min(2).max(4),
  daysToExpiry: z.number().min(0, "DTE must be non-negative"),
  quantity: z.number().int().positive("Quantity must be positive"),
  mode: z.enum(["put-spread", "call-spread", "iron-condor"]),
}).refine(
  (data) => {
    const expectedLegs = data.mode === "iron-condor" ? 4 : 2;
    return data.legs.length === expectedLegs;
  },
  { message: "Leg count must match spread mode (2 for spreads, 4 for iron condor)" },
);

export type IronCondorAnalyzeInput = z.infer<typeof ironCondorAnalyzeSchema>;

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
  limitPrice: z.number().positive("Limit price must be positive"),
});

export type IronCondorOrderInput = z.infer<typeof ironCondorOrderSchema>;

export const closeSpreadOrderSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  legs: z.array(orderLegSchema).min(2).max(4),
  quantity: z.number().int().positive("Quantity must be positive"),
  limitPrice: z.number().min(0, "Limit price must be non-negative"),
});

export type CloseSpreadOrderInput = z.infer<typeof closeSpreadOrderSchema>;
