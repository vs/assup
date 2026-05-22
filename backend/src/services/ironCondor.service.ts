/**
 * Iron Condor Builder service
 * Handles options chain fetching for index options, Black-Scholes analysis,
 * and combo order placement via IBKR.
 */

import type {
  IronCondorAnalyzeRequest,
  IronCondorAnalyzeResponse,
  IronCondorLeg,
} from "@assup/shared";

// --- Black-Scholes ---

/** Cumulative standard normal distribution (Abramowitz & Stegun approximation) */
function cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Black-Scholes probability of option expiring ITM.
 * P(ITM) for a call = N(d2), for a put = N(-d2)
 * where d2 = (ln(S/K) + (r - σ²/2) * T) / (σ * sqrt(T))
 */
function probabilityITM(
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

const SPX_MULTIPLIER = 100;

export function analyze(req: IronCondorAnalyzeRequest): IronCondorAnalyzeResponse {
  const { underlyingPrice, legs, daysToExpiry, quantity } = req;

  // Identify legs by role
  const buyPut = legs.find(l => l.type === "PUT" && l.side === "BUY")!;
  const sellPut = legs.find(l => l.type === "PUT" && l.side === "SELL")!;
  const sellCall = legs.find(l => l.type === "CALL" && l.side === "SELL")!;
  const buyCall = legs.find(l => l.type === "CALL" && l.side === "BUY")!;

  // Net credit calculation (conservative: sell at bid, buy at ask)
  const creditBid = (sellPut.bid - buyPut.ask) + (sellCall.bid - buyCall.ask);
  const creditAsk = (sellPut.ask - buyPut.bid) + (sellCall.ask - buyCall.bid);
  const creditMid = (creditBid + creditAsk) / 2;

  const netCredit = { bid: creditBid, ask: creditAsk, mid: creditMid };

  // Max profit = net credit received
  const maxProfit = creditMid * SPX_MULTIPLIER * quantity;

  // Max loss per side = (wing width - net credit) * multiplier * quantity
  const putWingWidth = sellPut.strike - buyPut.strike;
  const callWingWidth = buyCall.strike - sellCall.strike;
  const maxLossPut = (putWingWidth - creditMid) * SPX_MULTIPLIER * quantity;
  const maxLossCall = (callWingWidth - creditMid) * SPX_MULTIPLIER * quantity;

  // Breakevens
  const breakEvenLow = sellPut.strike - creditMid;
  const breakEvenHigh = sellCall.strike + creditMid;
  const breakEvenLowPercent = ((underlyingPrice - breakEvenLow) / underlyingPrice) * 100;
  const breakEvenHighPercent = ((breakEvenHigh - underlyingPrice) / underlyingPrice) * 100;

  // Probabilities using Black-Scholes with per-leg IV
  // Use breakeven prices (not short strikes) for probability of profit
  const pBelowBreakEvenLow = probabilityITM(underlyingPrice, breakEvenLow, sellPut.iv, daysToExpiry, "PUT");
  const pAboveBreakEvenHigh = probabilityITM(underlyingPrice, breakEvenHigh, sellCall.iv, daysToExpiry, "CALL");
  const pBelowBuyPut = probabilityITM(underlyingPrice, buyPut.strike, buyPut.iv, daysToExpiry, "PUT");
  const pAboveBuyCall = probabilityITM(underlyingPrice, buyCall.strike, buyCall.iv, daysToExpiry, "CALL");

  // P(profit) = probability of staying between breakeven points
  const probabilityOfProfit = Math.max(0, Math.min(1, 1 - pBelowBreakEvenLow - pAboveBreakEvenHigh));
  const probabilityOfMaxLossPut = pBelowBuyPut;
  const probabilityOfMaxLossCall = pAboveBuyCall;

  // Risk/reward ratio
  const worstLoss = Math.max(maxLossPut, maxLossCall);
  const riskRewardRatio = maxProfit > 0 ? worstLoss / maxProfit : Infinity;

  // Payoff curve: generate points from buyPut strike - 5% to buyCall strike + 5%
  const rangeMin = buyPut.strike * 0.95;
  const rangeMax = buyCall.strike * 1.05;
  const numPoints = 100;
  const step = (rangeMax - rangeMin) / numPoints;
  const payoffCurve: Array<{ price: number; pnl: number }> = [];

  for (let price = rangeMin; price <= rangeMax; price += step) {
    let pnl = creditMid; // start with credit received

    // Put spread P&L
    if (price < sellPut.strike) {
      pnl -= (sellPut.strike - price);
    }
    if (price < buyPut.strike) {
      pnl += (buyPut.strike - price);
    }

    // Call spread P&L
    if (price > sellCall.strike) {
      pnl -= (price - sellCall.strike);
    }
    if (price > buyCall.strike) {
      pnl += (price - buyCall.strike);
    }

    payoffCurve.push({
      price: Math.round(price * 100) / 100,
      pnl: Math.round(pnl * SPX_MULTIPLIER * quantity * 100) / 100,
    });
  }

  // Expected value: numerical integration using payoff curve and probability density
  const avgIV = (sellPut.iv + sellCall.iv) / 2;
  const sigma = avgIV / 100;
  const T = Math.max(daysToExpiry / 365, 1 / (365 * 24));
  let expectedValue = 0;

  for (let i = 0; i < payoffCurve.length - 1; i++) {
    const p1 = payoffCurve[i];
    const p2 = payoffCurve[i + 1];
    const midPrice = (p1.price + p2.price) / 2;
    const midPnl = (p1.pnl + p2.pnl) / 2;
    // Lognormal probability density
    const logReturn = Math.log(midPrice / underlyingPrice);
    const mean = -0.5 * sigma * sigma * T;
    const std = sigma * Math.sqrt(T);
    const density = Math.exp(-0.5 * ((logReturn - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI) * midPrice);
    const width = p2.price - p1.price;
    expectedValue += midPnl * density * width;
  }

  return {
    netCredit,
    maxProfit: Math.round(maxProfit * 100) / 100,
    maxLossPut: Math.round(maxLossPut * 100) / 100,
    maxLossCall: Math.round(maxLossCall * 100) / 100,
    breakEvenLow: Math.round(breakEvenLow * 100) / 100,
    breakEvenHigh: Math.round(breakEvenHigh * 100) / 100,
    breakEvenLowPercent: Math.round(breakEvenLowPercent * 100) / 100,
    breakEvenHighPercent: Math.round(breakEvenHighPercent * 100) / 100,
    probabilityOfProfit: Math.round(probabilityOfProfit * 10000) / 10000,
    probabilityOfMaxLossPut: Math.round(probabilityOfMaxLossPut * 10000) / 10000,
    probabilityOfMaxLossCall: Math.round(probabilityOfMaxLossCall * 10000) / 10000,
    expectedValue: Math.round(expectedValue * 100) / 100,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    payoffCurve,
  };
}
