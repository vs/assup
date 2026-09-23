/**
 * Zod schemas for order validation
 */

import { z } from "zod";

export const simulatedOrderSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20),
  secType: z.string().max(10).optional().default("STK"),
  action: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive("Quantity must be positive"),
  price: z.number().positive("Price must be positive"),
});

export const simulateOrdersRequestSchema = z.object({
  orders: z.array(simulatedOrderSchema).min(1, "At least one order is required"),
});

export type SimulatedOrderInput = z.infer<typeof simulatedOrderSchema>;
export type SimulateOrdersRequestInput = z.infer<typeof simulateOrdersRequestSchema>;

/**
 * Schema for placing option orders
 */
export const placeOrderSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20).toUpperCase(),
  expiration: z.string().length(8, "Expiration must be YYYYMMDD format"),
  strike: z.number().positive("Strike must be positive"),
  right: z.enum(["C", "P"], { errorMap: () => ({ message: "Right must be 'C' or 'P'" }) }),
  action: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive("Quantity must be positive"),
  limitPrice: z.number().positive("Limit price must be positive"),
  tif: z.enum(["DAY", "GTC"]).optional().default("DAY"),
  tradingClass: z.string().min(1).max(10).optional(),
});

export type PlaceOrderSchemaInput = z.infer<typeof placeOrderSchema>;

/**
 * Schema for modifying an existing order
 */
export const modifyOrderSchema = z.object({
  limitPrice: z.number().positive("Limit price must be positive"),
  quantity: z.number().int().positive("Quantity must be positive"),
  tif: z.enum(["DAY", "GTC"]).optional(),
});

export type ModifyOrderSchemaInput = z.infer<typeof modifyOrderSchema>;

/**
 * Schema for getting an option quote
 */
export const optionQuoteSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20).toUpperCase(),
  expiration: z.string().length(8, "Expiration must be YYYYMMDD format"),
  strike: z.number().positive("Strike must be positive"),
  right: z.enum(["C", "P"], { errorMap: () => ({ message: "Right must be 'C' or 'P'" }) }),
  /** IBKR contract id; when given, the quote shares the contract's existing market data line */
  conId: z.number().int().positive().optional(),
});

export type OptionQuoteSchemaInput = z.infer<typeof optionQuoteSchema>;
