/**
 * Zod schemas for Roll Option endpoints
 */

import { z } from "zod";

export const rollCandidatesRequestSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  expiration: z.string().length(8, "Expiration must be YYYYMMDD format"),
  strike: z.number().positive(),
  right: z.enum(["C", "P"]),
  conId: z.number().int().positive(),
  minDTEBeyond: z.number().int().min(0).max(365).default(30),
});

export const rollOrderRequestSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  closeConId: z.number().int().positive(),
  openConId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  limitPrice: z.number().positive("Limit price (net credit) must be positive"),
});
