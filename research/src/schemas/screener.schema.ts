import { z } from "zod";

// Create a new screener config
export const createScreenerSchema = z.object({
  name: z.string().min(1).max(100),
  criteria: z.object({
    market: z.string().optional(),
    type: z.string().optional(),
    search: z.string().optional(),
    active: z.boolean().optional(),
    minMarketCap: z.number().positive().optional(),
    maxMarketCap: z.number().positive().optional(),
    minPrice: z.number().positive().optional(),
    maxPrice: z.number().positive().optional(),
    maxResults: z.number().int().min(1).max(50).optional(),
  }),
  schedule: z.string().min(1).max(50),
  enabled: z.boolean().optional(),
});

// Update an existing screener config (all fields optional)
export const updateScreenerSchema = createScreenerSchema.partial();

// ID param for single config operations
export const screenerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Query params for results listing
export const screenerResultsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
