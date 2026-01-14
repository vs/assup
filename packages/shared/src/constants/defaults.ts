/**
 * Default values and constants used across the application
 */

import type { ScannerCriteria } from "../types/scanner.js";
import type { DashboardSettings } from "../types/settings.js";

/**
 * Default asset class color (indigo)
 */
export const DEFAULT_ASSET_CLASS_COLOR = "#6366f1";

/**
 * Default security type
 */
export const DEFAULT_SEC_TYPE = "STK";

/**
 * Default assignment source
 */
export const DEFAULT_ASSIGNMENT_SOURCE = "manual";

/**
 * Default scanner criteria
 */
export const DEFAULT_SCANNER_CRITERIA: ScannerCriteria = {
  minDaysToExpiry: 14,
  maxDaysToExpiry: 60,
  minDelta: 0.2,
  maxDelta: 0.4,
  minAnnualizedReturn: 10,
  minPremiumPercent: 1,
  minStrikePercent: 75,
  maxStrikePercent: 100,
};

/**
 * Default dashboard settings
 */
export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  includeOptions: true,
  optionsWeightMode: "notional",
  chartsExpanded: true,
};

/**
 * Predefined color palette for asset classes
 */
export const ASSET_CLASS_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo (repeat)
] as const;

/**
 * Settings keys
 */
export const SETTINGS_KEYS = {
  DASHBOARD: "dashboard",
} as const;

/**
 * Local storage keys (frontend)
 */
export const STORAGE_KEYS = {
  POSITION_FILTERS: "assup-position-filters",
  SCANNER_CRITERIA: "assup-scanner-criteria",
} as const;
