/**
 * Formatting utilities for numbers, currency, and percentages
 * These functions are used across both frontend and backend
 */

export interface FormatNumberOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Format a number as USD currency
 */
export function formatCurrency(
  value: number,
  options?: FormatNumberOptions
): string {
  if (!Number.isFinite(value)) {
    return "$—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: options?.minimumFractionDigits ?? 2,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(value);
}

/**
 * Format a number with optional decimal places
 */
export function formatNumber(
  value: number,
  options?: FormatNumberOptions
): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(value);
}

/**
 * Format a number as a percentage with sign prefix
 */
export function formatPercent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) {
    return "—%";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Format a number as a simple percentage (no sign prefix)
 */
export function formatPercentSimple(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) {
    return "—%";
  }
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a large number with K/M/B suffixes
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
