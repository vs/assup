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
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const year = expiry.slice(2, 4);
    const monthNum = parseInt(expiry.slice(4, 6), 10);
    const day = expiry.slice(6, 8);
    const monthStr = months[monthNum - 1] || "";
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
