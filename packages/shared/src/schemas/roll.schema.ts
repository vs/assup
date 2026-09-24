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
  /** Strike band around the current strike, in percent (both directions) */
  strikeRangePercent: z.number().min(1).max(100).default(20),
});

export const rollOrderRequestSchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
  closeConId: z.number().int().positive(),
  openConId: z.number().int().min(0),
  openExpiration: z.string().length(8, "Expiration must be YYYYMMDD format"),
  openStrike: z.number().positive(),
  openRight: z.enum(["C", "P"]),
  quantity: z.number().int().positive(),
  /** Net credit per contract; negative means a debit roll (you pay to roll) */
  limitPrice: z.number().refine((v) => v !== 0, "Limit price must not be zero"),
});
