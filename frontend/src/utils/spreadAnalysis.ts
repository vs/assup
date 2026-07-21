/**
 * Pure spread analysis functions (no IBKR, no database, no network).
 * Ported from ironCondor.service.ts for use in tests and frontend.
 */

import type {
  IronCondorAnalyzeRequest,
  IronCondorAnalyzeResponse,
} from "@assup/shared";

// --- Black-Scholes ---

/** Cumulative standard normal distribution (Abramowitz & Stegun approximation) */
export function cdf(x: number): number {
  const b1 =  0.319381530;
  const b2 = -0.356563782;
  const b3 =  1.781477937;
  const b4 = -1.821255978;
  const b5 =  1.330274429;
  const p  =  0.2316419;

  const t = 1.0 / (1.0 + p * Math.abs(x));
  const d = 0.3989422820 * Math.exp(-x * x / 2);
  const prob = d * t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  return x > 0 ? 1 - prob : prob;
}

/**
 * Black-Scholes probability of option expiring ITM.
 * P(ITM) for a call = N(d2), for a put = N(-d2)
 * where d2 = (ln(S/K) + (r - σ²/2) * T) / (σ * sqrt(T))
 */
export function probabilityITM(
  spot: number,
  strike: number,
  iv: number,
  daysToExpiry: number,
  type: "PUT" | "CALL",
  riskFreeRate = 0.05,
): number {
  const T = Math.max(daysToExpiry / 365, 1 / (365 * 24));
  const sigma = iv / 100; // IV comes as percentage (e.g., 17.5 means 17.5%)

  if (sigma <= 0 || spot <= 0 || strike <= 0) return 0;

  const d2 = (Math.log(spot / strike) + (riskFreeRate - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));

  return type === "CALL" ? cdf(d2) : cdf(-d2);
}

// --- Analysis ---

const DEFAULT_MULTIPLIER = 100;

export function analyzeSpread(req: IronCondorAnalyzeRequest): IronCondorAnalyzeResponse {
  const { underlyingPrice, legs, daysToExpiry, quantity, mode } = req;
  const multiplier = DEFAULT_MULTIPLIER;

  // Identify legs by role — only require legs relevant to the mode
  const buyPut = legs.find(l => l.type === "PUT" && l.side === "BUY");
  const sellPut = legs.find(l => l.type === "PUT" && l.side === "SELL");
  const sellCall = legs.find(l => l.type === "CALL" && l.side === "SELL");
  const buyCall = legs.find(l => l.type === "CALL" && l.side === "BUY");

  const hasPutSpread = mode === "put-spread" || mode === "iron-condor";
  const hasCallSpread = mode === "call-spread" || mode === "iron-condor";

  if (hasPutSpread && (!buyPut || !sellPut)) {
    throw new Error("Put spread requires one BUY PUT and one SELL PUT leg");
  }
  if (hasCallSpread && (!sellCall || !buyCall)) {
    throw new Error("Call spread requires one SELL CALL and one BUY CALL leg");
  }

  // Net credit calculation (conservative: sell at bid, buy at ask)
  let creditBid = 0;
  let creditAsk = 0;
  if (hasPutSpread) {
    creditBid += sellPut!.bid - buyPut!.ask;
    creditAsk += sellPut!.ask - buyPut!.bid;
  }
  if (hasCallSpread) {
    creditBid += sellCall!.bid - buyCall!.ask;
    creditAsk += sellCall!.ask - buyCall!.bid;
  }
  const creditMid = (creditBid + creditAsk) / 2;
  const netCredit = { bid: creditBid, ask: creditAsk, mid: creditMid };

  // Max profit = net credit received
  const maxProfit = creditMid * multiplier * quantity;

  // Max loss per side
  let maxLossPut: number | null = null;
  let maxLossCall: number | null = null;
  if (hasPutSpread) {
    const putWingWidth = sellPut!.strike - buyPut!.strike;
    maxLossPut = (putWingWidth - creditMid) * multiplier * quantity;
  }
  if (hasCallSpread) {
    const callWingWidth = buyCall!.strike - sellCall!.strike;
    maxLossCall = (callWingWidth - creditMid) * multiplier * quantity;
  }

  // Breakevens
  let breakEvenLow: number | null = null;
  let breakEvenHigh: number | null = null;
  let breakEvenLowPercent: number | null = null;
  let breakEvenHighPercent: number | null = null;
  if (hasPutSpread) {
    breakEvenLow = sellPut!.strike - creditMid;
    breakEvenLowPercent = ((underlyingPrice - breakEvenLow) / underlyingPrice) * 100;
  }
  if (hasCallSpread) {
    breakEvenHigh = sellCall!.strike + creditMid;
    breakEvenHighPercent = ((breakEvenHigh - underlyingPrice) / underlyingPrice) * 100;
  }

  // Probabilities using Black-Scholes
  let pBelowBreakEvenLow = 0;
  let pAboveBreakEvenHigh = 0;
  let probabilityOfMaxLossPut: number | null = null;
  let probabilityOfMaxLossCall: number | null = null;

  if (hasPutSpread) {
    pBelowBreakEvenLow = probabilityITM(underlyingPrice, breakEvenLow!, sellPut!.iv, daysToExpiry, "PUT");
    probabilityOfMaxLossPut = probabilityITM(underlyingPrice, buyPut!.strike, buyPut!.iv, daysToExpiry, "PUT");
  }
  if (hasCallSpread) {
    pAboveBreakEvenHigh = probabilityITM(underlyingPrice, breakEvenHigh!, sellCall!.iv, daysToExpiry, "CALL");
    probabilityOfMaxLossCall = probabilityITM(underlyingPrice, buyCall!.strike, buyCall!.iv, daysToExpiry, "CALL");
  }

  const probabilityOfProfit = Math.max(0, Math.min(1, 1 - pBelowBreakEvenLow - pAboveBreakEvenHigh));

  // Risk/reward ratio
  const losses = [maxLossPut, maxLossCall].filter((v): v is number => v != null);
  const worstLoss = Math.max(...losses);
  const riskRewardRatio = maxProfit > 0 ? worstLoss / maxProfit : Infinity;

  // Payoff curve
  let rangeMin: number;
  let rangeMax: number;
  if (mode === "put-spread") {
    rangeMin = buyPut!.strike * 0.95;
    rangeMax = sellPut!.strike * 1.05;
  } else if (mode === "call-spread") {
    rangeMin = sellCall!.strike * 0.95;
    rangeMax = buyCall!.strike * 1.05;
  } else {
    rangeMin = buyPut!.strike * 0.95;
    rangeMax = buyCall!.strike * 1.05;
  }

  const numPoints = 100;
  const step = (rangeMax - rangeMin) / numPoints;
  const payoffCurve: Array<{ price: number; pnl: number }> = [];

  for (let i = 0; i < numPoints; i++) {
    const price = rangeMin + i * step;
    let pnl = creditMid;

    if (hasPutSpread) {
      if (price < sellPut!.strike) pnl -= (sellPut!.strike - price);
      if (price < buyPut!.strike) pnl += (buyPut!.strike - price);
    }
    if (hasCallSpread) {
      if (price > sellCall!.strike) pnl -= (price - sellCall!.strike);
      if (price > buyCall!.strike) pnl += (price - buyCall!.strike);
    }

    payoffCurve.push({
      price: Math.round(price * 100) / 100,
      pnl: Math.round(pnl * multiplier * quantity * 100) / 100,
    });
  }

  // Expected value
  const ivForEV: number[] = [];
  if (hasPutSpread) ivForEV.push(sellPut!.iv);
  if (hasCallSpread) ivForEV.push(sellCall!.iv);
  const avgIV = ivForEV.reduce((a, b) => a + b, 0) / ivForEV.length;
  const sigma = avgIV / 100;
  const T = Math.max(daysToExpiry / 365, 1 / (365 * 24));
  let expectedValue = 0;

  if (sigma > 0) {
    for (let i = 0; i < payoffCurve.length - 1; i++) {
      const p1 = payoffCurve[i];
      const p2 = payoffCurve[i + 1];
      const midPrice = (p1.price + p2.price) / 2;
      const midPnl = (p1.pnl + p2.pnl) / 2;
      const logReturn = Math.log(midPrice / underlyingPrice);
      const mean = -0.5 * sigma * sigma * T;
      const std = sigma * Math.sqrt(T);
      const density = Math.exp(-0.5 * ((logReturn - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI) * midPrice);
      const width = p2.price - p1.price;
      expectedValue += midPnl * density * width;
    }
  }

  return {
    netCredit,
    maxProfit: Math.round(maxProfit * 100) / 100,
    maxLossPut: maxLossPut != null ? Math.round(maxLossPut * 100) / 100 : null,
    maxLossCall: maxLossCall != null ? Math.round(maxLossCall * 100) / 100 : null,
    breakEvenLow: breakEvenLow != null ? Math.round(breakEvenLow * 100) / 100 : null,
    breakEvenHigh: breakEvenHigh != null ? Math.round(breakEvenHigh * 100) / 100 : null,
    breakEvenLowPercent: breakEvenLowPercent != null ? Math.round(breakEvenLowPercent * 100) / 100 : null,
    breakEvenHighPercent: breakEvenHighPercent != null ? Math.round(breakEvenHighPercent * 100) / 100 : null,
    probabilityOfProfit: Math.round(probabilityOfProfit * 10000) / 10000,
    probabilityOfMaxLossPut: probabilityOfMaxLossPut != null ? Math.round(probabilityOfMaxLossPut * 10000) / 10000 : null,
    probabilityOfMaxLossCall: probabilityOfMaxLossCall != null ? Math.round(probabilityOfMaxLossCall * 10000) / 10000 : null,
    expectedValue: Math.round(expectedValue * 100) / 100,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    payoffCurve,
  };
}

// --- Hedged payoff analysis ---

export interface HedgedPayoffResult {
  payoffCurve: Array<{ price: number; pnl: number }>;
  maxProfit: number;
  maxLoss: number;
  hedgeCost: number;
  breakEvenLow: number | null;
  breakEvenHigh: number | null;
}

interface HedgePayoffInput {
  /** Existing spread legs (from the active position) */
  existingLegs: Array<{ strike: number; type: "PUT" | "CALL"; side: "BUY" | "SELL" }>;
  /** New legs being added as the hedge */
  newLegs: Array<{ strike: number; type: "PUT" | "CALL"; side: "BUY" | "SELL"; bid: number; ask: number }>;
  /** Net credit originally received for the spread (positive = credit) */
  originalCreditMid: number;
  /** Debit limit price the user is willing to pay for the hedge */
  hedgeDebitLimit: number;
  quantity: number;
}

/**
 * Compute the payoff curve for a hedged position (original spread + new hedge legs).
 * Works for both butterfly conversion and protective option hedges.
 */
export function computeHedgedPayoff(input: HedgePayoffInput): HedgedPayoffResult {
  const { existingLegs, newLegs, originalCreditMid, hedgeDebitLimit, quantity } = input;
  const multiplier = DEFAULT_MULTIPLIER;

  const allLegs = [...existingLegs, ...newLegs.map(l => ({ strike: l.strike, type: l.type, side: l.side }))];

  // Net credit after hedge cost
  const netCreditAfterHedge = originalCreditMid - hedgeDebitLimit;

  // Determine price range from all strikes
  const allStrikes = allLegs.map(l => l.strike);
  const minStrike = Math.min(...allStrikes);
  const maxStrike = Math.max(...allStrikes);
  const rangeMin = minStrike * 0.95;
  const rangeMax = maxStrike * 1.05;

  const numPoints = 100;
  const step = (rangeMax - rangeMin) / numPoints;
  const payoffCurve: Array<{ price: number; pnl: number }> = [];

  let maxProfit = -Infinity;
  let maxLoss = Infinity;

  for (let i = 0; i <= numPoints; i++) {
    const price = rangeMin + i * step;
    let pnl = netCreditAfterHedge;

    for (const leg of allLegs) {
      const isSell = leg.side === "SELL";
      const factor = isSell ? -1 : 1;

      if (leg.type === "PUT" && price < leg.strike) {
        pnl += factor * (leg.strike - price);
      }
      if (leg.type === "CALL" && price > leg.strike) {
        pnl += factor * (price - leg.strike);
      }
    }

    const pnlDollars = Math.round(pnl * multiplier * quantity * 100) / 100;
    payoffCurve.push({ price: Math.round(price * 100) / 100, pnl: pnlDollars });
    if (pnlDollars > maxProfit) maxProfit = pnlDollars;
    if (pnlDollars < maxLoss) maxLoss = pnlDollars;
  }

  // Find all breakevens (where payoff crosses zero).
  // Collect all crossings in price order, then assign lowest and highest —
  // this correctly handles butterflies and protective positions where both
  // crossings can lie on the same side of the current spot.
  const breakevens: number[] = [];
  for (let i = 0; i < payoffCurve.length - 1; i++) {
    const p1 = payoffCurve[i];
    const p2 = payoffCurve[i + 1];
    if ((p1.pnl <= 0 && p2.pnl > 0) || (p1.pnl >= 0 && p2.pnl < 0)) {
      const crossPrice = p1.price + ((0 - p1.pnl) / (p2.pnl - p1.pnl)) * (p2.price - p1.price);
      breakevens.push(Math.round(crossPrice * 100) / 100);
    }
  }
  breakevens.sort((a, b) => a - b);
  const breakEvenLow = breakevens[0] ?? null;
  const breakEvenHigh = breakevens.length > 1 ? breakevens[breakevens.length - 1] : null;

  return {
    payoffCurve,
    maxProfit: Math.round(maxProfit * 100) / 100,
    maxLoss: Math.round(Math.abs(maxLoss) * 100) / 100,
    hedgeCost: Math.round(hedgeDebitLimit * multiplier * quantity * 100) / 100,
    breakEvenLow,
    breakEvenHigh,
  };
}
