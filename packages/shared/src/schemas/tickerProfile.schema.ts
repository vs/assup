// packages/shared/src/schemas/tickerProfile.schema.ts

import { z } from "zod";

export const tickerProfileParamSchema = z.object({
  symbol: z.string().min(1).max(20),
});

export const tickerProfileBatchRequestSchema = z.object({
  symbols: z.array(z.string().min(1).max(20)).min(1).max(50),
});

export type TickerProfileParam = z.infer<typeof tickerProfileParamSchema>;
export type TickerProfileBatchRequest = z.infer<typeof tickerProfileBatchRequestSchema>;
