import type { OptionsChainEntry } from "../../providers/types.js";

export function generateOptionsChain(opts: {
  symbol?: string;
  callVolume?: number;
  putVolume?: number;
  iv?: number;
  openInterest?: number;
  bidAskSpread?: number;
} = {}): OptionsChainEntry[] {
  const {
    symbol = "AAPL",
    callVolume = 500,
    putVolume = 300,
    iv = 0.3,
    openInterest = 1000,
    bidAskSpread = 0.10,
  } = opts;

  const chain: OptionsChainEntry[] = [];
  const expiration = "2026-03-20";
  const strikes = [140, 145, 150, 155, 160];

  for (const strike of strikes) {
    chain.push({
      symbol, expiration, strike, right: "C",
      bid: 5.0, ask: 5.0 + bidAskSpread, last: 5.05,
      volume: callVolume, openInterest,
      impliedVolatility: iv, delta: 0.5, gamma: 0.03, theta: -0.05,
    });
    chain.push({
      symbol, expiration, strike, right: "P",
      bid: 3.0, ask: 3.0 + bidAskSpread, last: 3.05,
      volume: putVolume, openInterest,
      impliedVolatility: iv, delta: -0.3, gamma: 0.03, theta: -0.04,
    });
  }
  return chain;
}
