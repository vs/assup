import { z } from "zod";

export const yearParamSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export const exchangeRateFetchSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currencies: z.array(z.string().length(3)).optional(),
});

export type YearParam = z.infer<typeof yearParamSchema>;
export type ExchangeRateFetchParams = z.infer<typeof exchangeRateFetchSchema>;
