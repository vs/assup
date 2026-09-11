/**
 * Currency conversion helpers shared by profit, wheel and tax-adjacent services.
 */

import { cnbExchangeRateService } from "./cnbExchangeRate.service.js";

/**
 * Convert an amount from a foreign currency to USD using CNB rates.
 * CNB rates are expressed as CZK per 1 unit of foreign currency.
 * To convert currency X to USD: (amount in X) * (CZK per X) / (CZK per USD)
 */
export async function convertToUsd(
  amount: number,
  currency: string,
  date: Date
): Promise<number> {
  // USD amounts don't need conversion
  if (currency === "USD") {
    return amount;
  }

  // Get USD rate (CZK per 1 USD)
  const usdRate = await cnbExchangeRateService.getRate(date, "USD");
  if (!usdRate) {
    // If no USD rate available, return original amount (will be treated as USD)
    console.warn(`No USD exchange rate found for ${date.toISOString().split("T")[0]}`);
    return amount;
  }

  // CZK amounts: divide by USD rate to get USD
  if (currency === "CZK") {
    return amount / usdRate;
  }

  // Other currencies: get the currency's rate and convert via CZK
  const currencyRate = await cnbExchangeRateService.getRate(date, currency);
  if (!currencyRate) {
    // If no rate available, return original amount (will be treated as USD)
    console.warn(`No ${currency} exchange rate found for ${date.toISOString().split("T")[0]}`);
    return amount;
  }

  // Convert: amount * (CZK per currency) / (CZK per USD) = amount in USD
  return (amount * currencyRate) / usdRate;
}
