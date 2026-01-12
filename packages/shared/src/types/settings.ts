/**
 * Settings types for application configuration
 */

import type { OptionsWeightMode } from "./position.js";

export interface DashboardSettings {
  includeOptions: boolean;
  optionsWeightMode: OptionsWeightMode;
  chartsExpanded: boolean;
}

export interface SettingValue<T> {
  key: string;
  value: T;
}
