/**
 * Zod schemas for asset class validation
 */

import { z } from "zod";

export const assetClassCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  description: z.string().max(500, "Description must be 500 characters or less").optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color (e.g., #6366f1)")
    .optional()
    .default("#6366f1"),
});

export const assetClassUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const assetClassIdParamSchema = z.object({
  id: z.string().uuid("Invalid asset class ID"),
});

export type AssetClassCreateInput = z.infer<typeof assetClassCreateSchema>;
export type AssetClassUpdateInput = z.infer<typeof assetClassUpdateSchema>;
