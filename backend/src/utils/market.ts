/**
 * Shared market-related utilities
 */

const US_MARKET_OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM ET
const US_MARKET_CLOSE_MINUTES = 16 * 60; // 4:00 PM ET

/**
 * Check if US equity markets are currently open (weekdays 9:30-16:00 ET)
 */
export function isMarketOpen(): boolean {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = etTime.getDay();
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Weekend check (0 = Sunday, 6 = Saturday)
  if (day === 0 || day === 6) return false;

  return timeInMinutes >= US_MARKET_OPEN_MINUTES && timeInMinutes < US_MARKET_CLOSE_MINUTES;
}

/**
 * Parse IBKR option expiration date string (YYYYMMDD or YYMMDD format) into a Date
 */
export function parseExpirationDate(expiration: string): Date {
  let year: number;
  let month: number;
  let day: number;

  if (expiration.length === 8) {
    // YYYYMMDD
    year = parseInt(expiration.substring(0, 4), 10);
    month = parseInt(expiration.substring(4, 6), 10) - 1; // Month is 0-indexed
    day = parseInt(expiration.substring(6, 8), 10);
  } else if (expiration.length === 6) {
    // YYMMDD
    year = 2000 + parseInt(expiration.substring(0, 2), 10);
    month = parseInt(expiration.substring(2, 4), 10) - 1;
    day = parseInt(expiration.substring(4, 6), 10);
  } else {
    throw new Error(`Invalid expiration format: ${expiration}`);
  }

  return new Date(year, month, day);
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
