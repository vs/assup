/**
 * Zod schemas for scanner validation
 */

import { z } from "zod";

export const scannerCriteriaSchema = z.object({
  minDaysToExpiry: z.number().int().min(0).max(365),
  maxDaysToExpiry: z.number().int().min(0).max(365),
  minDelta: z.number().min(0).max(1),
  maxDelta: z.number().min(0).max(1),
  minAnnualizedReturn: z.number().min(0).max(1000),
  minPremiumPercent: z.number().min(0).max(100),
  minStrikePercent: z.number().min(0).max(100),
  maxStrikePercent: z.number().min(0).max(150),
  specificSymbol: z.string().min(1).max(10).toUpperCase().optional(),
  targetAssetClasses: z.array(z.string().uuid()).optional(),
});

export const scannerPresetCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  criteria: scannerCriteriaSchema,
  isDefault: z.boolean().optional().default(false),
});

export const scannerPresetUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  criteria: scannerCriteriaSchema.optional(),
  isDefault: z.boolean().optional(),
});

export const scannerPresetIdParamSchema = z.object({
  id: z.string().uuid("Invalid preset ID"),
});

export type ScannerCriteriaInput = z.infer<typeof scannerCriteriaSchema>;
export type ScannerPresetCreateInput = z.infer<typeof scannerPresetCreateSchema>;
export type ScannerPresetUpdateInput = z.infer<typeof scannerPresetUpdateSchema>;
