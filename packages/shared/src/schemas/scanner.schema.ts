/**
 * Zod schemas for scanner validation
 */

import { z } from "zod";

export const optionTypeFilterSchema = z.enum(["PUT", "CALL"]);

export const scannerCriteriaSchema = z.object({
  optionTypes: optionTypeFilterSchema.default("PUT"),
  minDaysToExpiry: z.number().int().min(0).max(365),
  maxDaysToExpiry: z.number().int().min(0).max(365),
  minDelta: z.number().min(0).max(1),
  maxDelta: z.number().min(0).max(1),
  minAnnualizedReturn: z.number().min(0).max(1000),
  minPremiumPercent: z.number().min(0).max(100),
  // PUT strike range (% of underlying price, typically 50-100 for OTM puts)
  putMinStrikePercent: z.number().min(0).max(150).default(75),
  putMaxStrikePercent: z.number().min(0).max(150).default(100),
  // CALL strike range (% of underlying price, typically 100-150 for OTM calls)
  callMinStrikePercent: z.number().min(0).max(200).default(100),
  callMaxStrikePercent: z.number().min(0).max(200).default(125),
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
