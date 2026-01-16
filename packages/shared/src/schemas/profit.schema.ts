/**
 * Zod schemas for profit tracking validation
 */

import { z } from "zod";

// Query schema for monthly profit list
export const monthlyProfitQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
});

// Params schema for month detail endpoint
export const monthParamsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

// Params schema for import batch ID
export const importBatchIdParamSchema = z.object({
  id: z.string().uuid("Invalid import batch ID"),
});

// Cash transaction type enum
export const cashTransactionTypeSchema = z.enum([
  "DIVIDEND",
  "INTEREST",
  "WITHHOLDING_TAX",
  "FEE",
  "OTHER",
]);

// Inferred types
export type MonthlyProfitQueryInput = z.infer<typeof monthlyProfitQuerySchema>;
export type MonthParamsInput = z.infer<typeof monthParamsSchema>;
export type ImportBatchIdParamInput = z.infer<typeof importBatchIdParamSchema>;
export type CashTransactionTypeInput = z.infer<typeof cashTransactionTypeSchema>;
