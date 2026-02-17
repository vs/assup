import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency value for display
 */
export function formatCurrency(value: number, currency = "USD"): string {
  if (currency === "CZK") {
    return new Intl.NumberFormat("cs-CZ", {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format holding period in days to human readable format
 */
export function formatHoldingPeriod(days: number): string {
  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  if (years > 0) {
    return `${years}y ${remainingDays}d`;
  }
  return `${days}d`;
}

/**
 * Scroll to element and highlight it briefly
 */
export function scrollToAndHighlight(elementId: string): void {
  const element = document.getElementById(elementId);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("bg-blue-100");
    setTimeout(() => element.classList.remove("bg-blue-100"), 1500);
  }
}
