/**
 * Iron Condor Builder service
 * Handles options chain fetching for index options, Black-Scholes analysis,
 * and combo order placement via IBKR.
 */

import {
  Contract,
  SecType,
  OptionType,
  OrderAction,
  OrderType,
  TimeInForce,
} from "@stoqey/ib";
import type { Order } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { withLiveMarketData } from "../utils/options.js";
import { parseExpirationDate } from "../utils/market.js";
import type {
  IronCondorAnalyzeRequest,
  IronCondorAnalyzeResponse,
  IronCondorLeg,
  IronCondorChainResponse,
  IronCondorChainStrike,
  IronCondorOrderRequest,
  IronCondorOrderResponse,
} from "@assup/shared";

const SYMBOL_CONFIG: Record<string, { tradingClass: string; multiplier: number }> = {
  SPX: { tradingClass: "SPXW", multiplier: 100 },
  XSP: { tradingClass: "XSPW", multiplier: 100 },
  RUT: { tradingClass: "RUTW", multiplier: 100 },
};

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

const DEFAULT_MULTIPLIER = 100;

export function analyze(req: IronCondorAnalyzeRequest): IronCondorAnalyzeResponse {
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

  for (let price = rangeMin; price <= rangeMax; price += step) {
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

// --- Chain Fetch ---

/**
 * Fetch options chain for an index (SPX) from IBKR.
 * Uses SecType.IND (not STK) and handles SPX/SPXW trading classes.
 * Only fetches market data for strikes within ±15% of underlying price.
 */
export async function getChain(symbol: string, targetDte: number): Promise<IronCondorChainResponse> {
  const api = ibkrService.getApi();
  if (!api || !api.isConnected) {
    throw new Error("Not connected to TWS");
  }

  // 1. Get underlying price
  const underlyingContract: Contract = {
    symbol,
    secType: SecType.IND,
    exchange: "CBOE",
    currency: "USD",
  };

  const underlyingData = await ibkrService.getMarketData(underlyingContract);
  const underlyingPrice = underlyingData?.last ?? underlyingData?.close ?? 0;
  if (underlyingPrice <= 0) {
    throw new Error(`Could not get price for ${symbol}`);
  }

  // 2. Get contract details for the index
  const details = await api.getContractDetails(underlyingContract);
  if (!details || details.length === 0) {
    throw new Error(`No contract details found for ${symbol}`);
  }

  // 3. Get security definitions for options
  const secDefs = await api.getSecDefOptParams(
    symbol,
    "",
    SecType.IND,
    details[0].contract.conId!,
  );

  if (!secDefs || secDefs.length === 0) {
    throw new Error(`No options available for ${symbol}`);
  }

  // Use symbol-specific trading class
  const config = SYMBOL_CONFIG[symbol];
  if (!config) throw new Error(`Unsupported symbol: ${symbol}. Supported: ${Object.keys(SYMBOL_CONFIG).join(", ")}`);
  const preferredDefs = secDefs.filter(d => d.tradingClass === config.tradingClass);
  const activeDefs = preferredDefs.length > 0 ? preferredDefs : secDefs;
  const tradingClass = activeDefs[0]?.tradingClass ?? symbol;
  const multiplier = Number(activeDefs[0]?.multiplier ?? config.multiplier);

  // 4. Collect all available expirations
  const allExpirations = new Set<string>();
  for (const def of activeDefs) {
    if (def.expirations) {
      for (const exp of def.expirations) allExpirations.add(exp);
    }
  }

  const expirations = Array.from(allExpirations).sort();

  // 5. Find the expiration closest to target DTE
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let selectedExpiration = expirations[0] ?? "";

  for (const exp of expirations) {
    const expDate = parseExpirationDate(exp);
    const dte = Math.floor((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (dte >= targetDte) {
      selectedExpiration = exp;
      break;
    }
  }

  // 6. Collect strikes for selected expiration (within ±15% of underlying)
  const minStrike = underlyingPrice * 0.85;
  const maxStrike = underlyingPrice * 1.15;
  const strikes = new Set<number>();

  for (const def of activeDefs) {
    if (!def.strikes) continue;
    for (const strike of def.strikes) {
      if (strike >= minStrike && strike <= maxStrike) {
        strikes.add(strike);
      }
    }
  }

  const sortedStrikes = Array.from(strikes).sort((a, b) => a - b);

  // 7. Build contracts and fetch market data
  const chain: IronCondorChainStrike[] = [];

  await withLiveMarketData(async () => {
    const contracts: Contract[] = [];

    for (const strike of sortedStrikes) {
      for (const right of [OptionType.Put, OptionType.Call] as const) {
        const contract: Contract = {
          symbol,
          secType: SecType.OPT,
          exchange: "SMART",
          currency: "USD",
          lastTradeDateOrContractMonth: selectedExpiration,
          strike,
          right,
          multiplier,
          tradingClass,
        };
        contracts.push(contract);
      }
    }

    // Batch fetch market data
    const marketData = await ibkrService.getMarketDataBatch(contracts);

    // Group by strike
    const strikeMap = new Map<number, { put: any; call: any }>();

    for (const [, data] of marketData) {
      const strike = data.contract.strike!;
      const type = data.contract.right === OptionType.Put ? "put" : "call";

      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, { put: null, call: null });
      }

      // IBKR returns NaN or negative values (-1, -2) for unavailable data.
      // Clamp all values to 0 minimum to avoid NaN/negative propagation.
      const safeNum = (v: number | undefined, min = 0) => {
        if (v == null || !Number.isFinite(v) || v < min) return 0;
        return v;
      };
      const bid = safeNum(data.bid);
      const ask = safeNum(data.ask);
      const option = {
        conId: data.contract.conId ?? 0,
        bid,
        ask,
        mid: bid > 0 && ask > 0 ? (bid + ask) / 2 : 0,
        last: safeNum(data.last),
        delta: Math.abs(safeNum(data.delta, -Infinity)),
        iv: safeNum(data.impliedVolatility) * 100,
      };

      strikeMap.get(strike)![type] = option;
    }

    for (const strike of sortedStrikes) {
      const data = strikeMap.get(strike);
      chain.push({
        strike,
        put: data?.put ?? null,
        call: data?.call ?? null,
      });
    }
  });

  return {
    underlyingPrice,
    expirations,
    selectedExpiration,
    chain,
  };
}

// --- Combo Order ---

/**
 * Place an iron condor as a multi-leg combo (BAG) order via IBKR.
 */
export async function placeComboOrder(req: IronCondorOrderRequest): Promise<IronCondorOrderResponse> {
  const api = ibkrService.getApi();
  if (!api || !api.isConnected) {
    throw new Error("Not connected to TWS");
  }

  // Build BAG contract
  const comboContract: Contract = {
    symbol: req.symbol,
    secType: "BAG" as SecType,
    exchange: "SMART",
    currency: "USD",
    comboLegs: req.legs.map(leg => ({
      conId: leg.conId,
      ratio: 1,
      action: leg.side === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      exchange: leg.exchange,
    })),
  };

  // Build order — action is "BUY" for the combo.
  // IBKR BAG convention: order-level action = BUY, each ComboLeg specifies its own action.
  // The net credit is received because the sold legs generate more premium than the bought legs cost.
  // Limit price is the net credit we want to receive (positive = credit for the combo).
  const order: Order = {
    action: OrderAction.BUY,
    totalQuantity: req.quantity,
    orderType: OrderType.LMT,
    lmtPrice: req.limitPrice,
    tif: TimeInForce.DAY,
    transmit: true,
    smartComboRoutingParams: [
      { tag: "NonGuaranteed", value: "1" },
    ],
  };

  const orderId = await api.placeNewOrder(comboContract, order);

  // Wait for order confirmation (same pattern as ibkrService.placeOrder)
  const maxWaitMs = 3000;
  const pollIntervalMs = 500;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    try {
      const orders = await ibkrService.getAllOpenOrders();
      const found = orders.find((o) => o.orderId === orderId);
      if (found) {
        const status = found.orderStatus?.status || found.orderState?.status;
        if (status === "Cancelled" || status === "Inactive") {
          throw new Error(`Order was ${status.toLowerCase()} by TWS`);
        }
        if (status === "PreSubmitted" || status === "Submitted" || status === "Filled") {
          return { orderId, status };
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Order was")) throw err;
    }
  }

  return { orderId, status: "Submitted" };
}
