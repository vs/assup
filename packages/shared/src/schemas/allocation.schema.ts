/**
 * Zod schemas for allocation profile validation
 */

import { z } from "zod";

export const allocationTargetSchema = z.object({
  assetClassId: z.string().uuid("Invalid asset class ID"),
  targetPercentage: z
    .number()
    .min(0, "Percentage must be at least 0")
    .max(100, "Percentage must be at most 100"),
});

export const allocationProfileCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  isActive: z.boolean().optional().default(false),
  targets: z.array(allocationTargetSchema).optional(),
});

export const allocationProfileUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  targets: z.array(allocationTargetSchema).optional(),
});

export const allocationProfileIdParamSchema = z.object({
  id: z.string().uuid("Invalid profile ID"),
});

export type AllocationTargetInput = z.infer<typeof allocationTargetSchema>;
export type AllocationProfileCreateInput = z.infer<typeof allocationProfileCreateSchema>;
export type AllocationProfileUpdateInput = z.infer<typeof allocationProfileUpdateSchema>;
