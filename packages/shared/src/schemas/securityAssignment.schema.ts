/**
 * Zod schemas for security assignment validation
 */

import { z } from "zod";

export const securityAssignmentCreateSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20).transform((s) => s.toUpperCase()),
  conId: z.number().int().positive().optional(),
  secType: z.string().min(1).max(10).optional().default("STK"),
  assetClassId: z.string().uuid("Invalid asset class ID"),
  source: z.string().max(50).optional().default("manual"),
});

export const securityAssignmentUpdateSchema = z.object({
  assetClassId: z.string().uuid("Invalid asset class ID"),
});

export const securityAssignmentBulkSchema = z.array(
  z.object({
    symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
    conId: z.number().int().positive().optional(),
    secType: z.string().min(1).max(10).optional().default("STK"),
    assetClassId: z.string().uuid(),
    source: z.string().max(50).optional().default("manual"),
  })
);

export const securityAssignmentIdParamSchema = z.object({
  id: z.string().uuid("Invalid assignment ID"),
});

export const securityAssignmentSymbolParamSchema = z.object({
  symbol: z.string().min(1),
});

export const securityAssignmentSymbolQuerySchema = z.object({
  secType: z.string().optional().default("STK"),
});

export type SecurityAssignmentCreateInput = z.infer<typeof securityAssignmentCreateSchema>;
export type SecurityAssignmentUpdateInput = z.infer<typeof securityAssignmentUpdateSchema>;
export type SecurityAssignmentBulkInput = z.infer<typeof securityAssignmentBulkSchema>;
