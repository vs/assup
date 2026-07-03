import { z } from "zod";

export const flexScheduleConfigSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1, "Select at least one day"),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  repeatHours: z.number().int().min(1).max(23).optional(),
});

export const flexWebConfigSchema = z.object({
  token: z.string().min(1, "Token is required"),
  queryId: z.string().min(1, "Query ID is required"),
  schedule: flexScheduleConfigSchema,
  enabled: z.boolean(),
});

export const flexFetchLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type FlexWebConfigInput = z.infer<typeof flexWebConfigSchema>;
export type FlexFetchLogQueryInput = z.infer<typeof flexFetchLogQuerySchema>;
