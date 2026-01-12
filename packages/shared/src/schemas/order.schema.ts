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
