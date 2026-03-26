// Wheel Scanner Scoring Model
// Each factor returns 0-100, composite is weighted average

const WEIGHTS = {
  ivRank: 0.25,
  putLiquidity: 0.2,
  premiumYield: 0.2,
  marketCap: 0.1,
  priceRange: 0.1,
  allocationNeed: 0.15,
} as const;

/** IV Rank score: linear 0-100 mapping */
export function scoreIvRank(ivRank: number): number {
  return Math.min(Math.max(ivRank, 0), 100);
}

/** Put liquidity score: 0% spread = 100, 20%+ spread = 0 */
export function scorePutLiquidity(avgSpreadPct: number): number {
  return Math.max(0, Math.min(100, ((0.2 - avgSpreadPct) / 0.2) * 100));
}

/** Premium yield score: linear 0-30% annualized maps to 0-100 */
export function scorePremiumYield(annualizedReturn: number): number {
  return Math.min(Math.max((annualizedReturn / 30) * 100, 0), 100);
}

/** Market cap score: log-scaled from $1B (0) to $500B (100) */
export function scoreMarketCap(marketCap: number): number {
  if (marketCap <= 1e9) return 0;
  if (marketCap >= 500e9) return 100;
  const logMin = Math.log10(1e9);
  const logMax = Math.log10(500e9);
  const logVal = Math.log10(marketCap);
  return ((logVal - logMin) / (logMax - logMin)) * 100;
}

/** Price range score: gaussian centered at $75, sigma ~$50 */
export function scorePriceRange(price: number): number {
  const center = 75;
  const sigma = 50;
  return 100 * Math.exp(-0.5 * ((price - center) / sigma) ** 2);
}

/** Allocation need score: linear 0-10% shortfall maps to 0-100 */
export function scoreAllocationNeed(shortfallPct: number): number {
  return Math.min(Math.max((shortfallPct / 10) * 100, 0), 100);
}

export interface FactorScores {
  ivRank: number;
  putLiquidity: number;
  premiumYield: number;
  marketCap: number;
  priceRange: number;
  allocationNeed: number;
}

/** Compute weighted composite score (0-100) */
export function computeCompositeScore(scores: FactorScores): number {
  return (
    scores.ivRank * WEIGHTS.ivRank +
    scores.putLiquidity * WEIGHTS.putLiquidity +
    scores.premiumYield * WEIGHTS.premiumYield +
    scores.marketCap * WEIGHTS.marketCap +
    scores.priceRange * WEIGHTS.priceRange +
    scores.allocationNeed * WEIGHTS.allocationNeed
  );
}
