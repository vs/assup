import { z } from "zod";

export const flexWebConfigSchema = z.object({
  token: z.string().min(1, "Token is required"),
  queryId: z.string().min(1, "Query ID is required"),
  schedule: z.string().min(1, "Schedule is required").refine(
    (val) => {
      // Basic cron validation: 5 space-separated fields
      const parts = val.trim().split(/\s+/);
      return parts.length === 5;
    },
    { message: "Invalid cron expression (expected 5 fields: min hour dom mon dow)" }
  ),
  enabled: z.boolean(),
});

export const flexFetchLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type FlexWebConfigInput = z.infer<typeof flexWebConfigSchema>;
export type FlexFetchLogQueryInput = z.infer<typeof flexFetchLogQuerySchema>;
