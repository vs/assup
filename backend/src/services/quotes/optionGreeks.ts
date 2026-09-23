/**
 * Option greeks from a QuoteHub quote, with a Black-Scholes theta fallback:
 * TWS often sends model delta before (or without) theta for equity options.
 */

import type { Quote, QuoteContract } from "./quoteTypes.js";

/** Standard normal CDF using Abramowitz & Stegun approximation */
function normcdf(x: number): number {
  const a = 0.2316419;
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937;
  const b4 = -1.821255978, b5 = 1.330274429;
  const ax = Math.abs(x);
  const t = 1 / (1 + a * ax);
  const pdf = Math.exp(-0.5 * ax * ax) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  return x >= 0 ? cdf : 1 - cdf;
}

/**
 * Black-Scholes daily theta (per-share).
 * Returns negative value (time decay erodes option value).
 */
function bsTheta(S: number, K: number, T: number, sigma: number, isPut: boolean, r = 0.05): number {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf_d1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const timeDecay = -(S * pdf_d1 * sigma) / (2 * sqrtT);
  const annualTheta = isPut
    ? timeDecay + r * K * Math.exp(-r * T) * normcdf(-d2)
    : timeDecay - r * K * Math.exp(-r * T) * normcdf(d2);
  return annualTheta / 365;
}

/** Days from today to YYYYMMDD expiry string */
function daysToExpiry(expiry: string): number {
  const y = parseInt(expiry.slice(0, 4));
  const m = parseInt(expiry.slice(4, 6)) - 1;
  const d = parseInt(expiry.slice(6, 8));
  const exp = new Date(y, m, d);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 86400000));
}

/**
 * Delta and per-share daily theta for an option quote. Theta comes from TWS
 * when present, else from Black-Scholes using TWS's IV and underlying price.
 * Returns null when TWS sent no delta.
 */
export function greeksFromQuote(
  quote: Quote,
  contract: QuoteContract,
): { delta: number; theta: number | null } | null {
  if (quote.delta == null) return null;

  let theta = quote.theta ?? null;
  if (theta == null && quote.iv != null && quote.iv > 0 && quote.undPrice != null) {
    const expiry = contract.lastTradeDateOrContractMonth;
    if (contract.strike && expiry) {
      const T = daysToExpiry(expiry) / 365;
      if (T > 0) {
        const right = (contract.right ?? "").toUpperCase();
        theta = bsTheta(quote.undPrice, contract.strike, T, quote.iv, right === "P" || right === "PUT");
      }
    }
  }
  return { delta: quote.delta, theta };
}
