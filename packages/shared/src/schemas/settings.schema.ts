/**
 * Zod schemas for settings validation
 */

import { z } from "zod";

export const settingKeyParamSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Invalid key format"),
});

export const settingValueSchema = z.object({
  value: z.unknown(),
});

export const dashboardSettingsSchema = z.object({
  includeOptions: z.boolean(),
  optionsWeightMode: z.enum(["notional", "delta"]),
  chartsExpanded: z.boolean(),
});

export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;
export type SettingValueInput = z.infer<typeof settingValueSchema>;
export type DashboardSettingsInput = z.infer<typeof dashboardSettingsSchema>;
