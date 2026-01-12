/**
 * Utilities for calculating position exposure and option values
 */

import type { Position, OptionRight } from "../types/position.js";

/**
 * Standard options contract multiplier
 */
export const OPTIONS_MULTIPLIER = 100;

/**
 * Default delta estimate for ATM options
 */
export const DEFAULT_ATM_DELTA = 0.5;

/**
 * Calculate option notional value (strike × quantity × multiplier)
 */
export function calculateOptionNotional(
  strike: number,
  quantity: number,
  multiplier = OPTIONS_MULTIPLIER
): number {
  return strike * Math.abs(quantity) * multiplier;
}

/**
 * Estimate delta for options without market data
 * Uses a simplified ATM assumption (delta ≈ 0.5)
 *
 * Returns signed delta based on position direction:
 * - Long CALL: +delta (buy exposure)
 * - Short CALL: -delta (sell exposure)
 * - Long PUT: -delta (hedge/sell exposure)
 * - Short PUT: +delta (buy exposure)
 */
export function estimateDelta(
  isLong: boolean,
  isPut: boolean,
  baseDelta = DEFAULT_ATM_DELTA
): number {
  if (isPut) {
    return isLong ? -baseDelta : baseDelta;
  }
  return isLong ? baseDelta : -baseDelta;
}

/**
 * Calculate the exposure for a position
 *
 * For stocks/ETFs: exposure = market value
 * For options: exposure = signed notional based on position type
 *   - Short PUT or Long CALL = positive exposure (obligation/right to buy)
 *   - Long PUT or Short CALL = negative exposure (right/obligation to sell)
 */
export function calculatePositionExposure(position: Position): number {
  if (position.secType === "OPT" && position.notionalValue !== undefined) {
    const isShort = position.position < 0;
    const isPut = position.right === "P";
    // Short PUT or Long CALL = buy underlying = positive exposure
    const willBuyUnderlying = (isPut && isShort) || (!isPut && !isShort);
    return willBuyUnderlying ? position.notionalValue : -position.notionalValue;
  }
  return position.marketValue ?? 0;
}

/**
 * Determine if a position represents an obligation/right to buy the underlying
 */
export function willBuyUnderlying(
  secType: string,
  position: number,
  right?: OptionRight
): boolean {
  if (secType !== "OPT") {
    return position > 0;
  }
  const isShort = position < 0;
  const isPut = right === "P";
  // Short PUT = obligation to buy, Long CALL = right to buy
  return (isPut && isShort) || (!isPut && !isShort);
}

/**
 * Calculate notional exposure sign for options positions
 * Used for allocation calculations
 */
export function getOptionsNotionalSign(
  position: number,
  right?: OptionRight
): number {
  const isShort = position < 0;
  const isPut = right === "P";

  if (isPut) {
    // Short PUT: +notional (obligation to buy)
    // Long PUT: -notional (right to sell/hedge)
    return isShort ? 1 : -1;
  } else {
    // Short CALL: -notional (obligation to sell)
    // Long CALL: +notional (right to buy)
    return isShort ? -1 : 1;
  }
}
