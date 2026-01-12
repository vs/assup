/**
 * Zod schemas for historical data validation
 */

import { z } from "zod";

export const sparklineSymbolParamSchema = z.object({
  symbol: z.string().min(1).max(20),
});

export const sparklineBatchRequestSchema = z.object({
  symbols: z.array(z.string().min(1).max(20)).min(1).max(100),
});

export type SparklineSymbolParam = z.infer<typeof sparklineSymbolParamSchema>;
export type SparklineBatchRequestInput = z.infer<typeof sparklineBatchRequestSchema>;
