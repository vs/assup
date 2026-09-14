import { z } from "zod";

export const tickerActivityParamSchema = z.object({
  symbol: z.string().min(1).max(20),
});

export type TickerActivityParam = z.infer<typeof tickerActivityParamSchema>;
