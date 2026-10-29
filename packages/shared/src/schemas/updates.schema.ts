/**
 * Zod schemas for the real-time updates API
 */

import { z } from "zod";

export const refreshUpdatesSchema = z.object({
  type: z.enum(["positions", "orders", "allocation", "all"], {
    errorMap: () => ({ message: 'type must be one of "positions", "orders", "allocation", "all"' }),
  }),
});

export type RefreshUpdatesInput = z.infer<typeof refreshUpdatesSchema>;
