/**
 * Zod schemas for position-related validation
 */

import { z } from "zod";

export const optionsWeightModeSchema = z.enum(["notional", "delta"]);

export const positionSummaryQuerySchema = z.object({
  includeOptions: z
    .string()
    .transform((val) => val === "true")
    .optional(),
  optionsWeightMode: optionsWeightModeSchema.optional(),
});

export type PositionSummaryQueryInput = z.infer<typeof positionSummaryQuerySchema>;
