/**
 * Utility functions for formatting contract/security information
 */

export interface ContractInfo {
  symbol?: string;
  secType?: string;
  strike?: number;
  right?: string;
  lastTradeDateOrContractMonth?: string;
}

/**
 * Month abbreviations for option expiry formatting
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a security display name.
 * For stocks: returns the symbol as-is
 * For options: returns formatted string like "AAPL Dec19'25 150 PUT"
 */
export function formatDisplayName(contract: ContractInfo): string {
  const symbol = contract.symbol || "";
  const secType = contract.secType || "STK";
  const isOption = secType === "OPT";

  if (!isOption) {
    return symbol;
  }

  const strike = contract.strike;
  const right = contract.right === "P" ? "PUT" : "CALL";
  const expiry = contract.lastTradeDateOrContractMonth;

  if (expiry && strike) {
    const year = expiry.slice(2, 4);
    const monthNum = parseInt(expiry.slice(4, 6), 10);
    const day = expiry.slice(6, 8);
    const monthStr = MONTHS[monthNum - 1] || "";
    return `${symbol} ${monthStr}${day}'${year} ${strike} ${right}`;
  }

  return symbol;
}

/**
 * Get the normalized right value for options ("P" or "C")
 * Returns undefined for non-options
 */
export function getOptionRight(contract: ContractInfo): "P" | "C" | undefined {
  const secType = contract.secType || "STK";
  if (secType !== "OPT") {
    return undefined;
  }
  return contract.right === "P" ? "P" : "C";
}

/**
 * Parse option expiry string (YYYYMMDD) into components
 */
export function parseOptionExpiry(expiry: string): {
  year: string;
  month: string;
  day: string;
  monthName: string;
} | null {
  if (!expiry || expiry.length < 8) {
    return null;
  }

  const year = expiry.slice(0, 4);
  const month = expiry.slice(4, 6);
  const day = expiry.slice(6, 8);
  const monthNum = parseInt(month, 10);
  const monthName = MONTHS[monthNum - 1] || "";

  return { year, month, day, monthName };
}

/**
 * Create a unique key for a security based on symbol and type
 */
export function getSecurityKey(symbol: string, secType: string): string {
  return `${symbol}:${secType}`;
}

/**
 * Check if a security type represents an option
 */
export function isOption(secType: string): boolean {
  return secType === "OPT";
}

/**
 * Check if a security type represents a stock
 */
export function isStock(secType: string): boolean {
  return secType === "STK";
}

/**
 * Check if a security type represents cash
 */
export function isCash(secType: string): boolean {
  return secType === "CASH";
}
