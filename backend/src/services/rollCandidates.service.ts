/**
 * Roll Candidates Service
 * Finds roll opportunities for a short option position: higher strike (calls) or
 * lower strike (puts) at a further expiry, filtered to positive net credit only.
 */

import { SecType, OptionType } from "@stoqey/ib";
import type { Contract } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import type { OptionChainEntry } from "./ibkr.js";
import { marketDataLineRegistry } from "./marketDataLineRegistry.js";
import {
  withLiveMarketData,
  getDaysToExpiry,
  marketDataKey,
} from "../utils/options.js";
import { parseExpirationDate } from "../utils/market.js";
import type {
  RollCandidatesRequest,
  RollCandidatesResponse,
  RollCandidate,
} from "@assup/shared";

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Filter option chain entries to valid roll candidates:
 * - For CALL: strike > currentStrike
 * - For PUT: strike < currentStrike
 * - Expiry at least minDTEBeyond calendar days after currentExpiration
 */
export function filterCandidateEntries(
  chain: OptionChainEntry[],
  currentStrike: number,
  currentExpiration: string,
  right: "C" | "P",
  minDTEBeyond: number,
): OptionChainEntry[] {
  const currentExpiryDate = parseExpirationDate(currentExpiration);
  const minMs = minDTEBeyond * 24 * 60 * 60 * 1000;

  return chain.filter((entry) => {
    const strikeOk =
      right === "C" ? entry.strike > currentStrike : entry.strike < currentStrike;
    if (!strikeOk) return false;

    const candidateExpiryDate = parseExpirationDate(entry.expiration);
    const diffMs = candidateExpiryDate.getTime() - currentExpiryDate.getTime();
    return diffMs >= minMs;
  });
}

/**
 * Compute conservative and mid-based net credits.
 * Conservative: candidateBid − closeAsk (worst-case fills)
 * Mid-based: candidateMid − closeMid (used for sorting/filtering)
 */
export function computeNetCredits(
  candidateBid: number,
  candidateAsk: number,
  closeAsk: number,
  closeBid: number,
): { netCredit: number; netCreditMid: number } {
  const candidateMid = (candidateBid + candidateAsk) / 2;
  const closeMid = (closeAsk + closeBid) / 2;
  return {
    netCredit: candidateBid - closeAsk,
    netCreditMid: candidateMid - closeMid,
  };
}

/**
 * Annualized return on the new leg: (netCreditMid / newStrike) * (365 / newDTE) * 100
 */
export function computeRollAnnualizedReturn(
  netCreditMid: number,
  newStrike: number,
  newDTE: number,
): number {
  if (newDTE <= 0 || newStrike <= 0) return 0;
  return (netCreditMid / newStrike) * (365 / newDTE) * 100;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Find all profitable roll candidates for a short option position.
 */
export async function findRollCandidates(
  input: RollCandidatesRequest,
): Promise<RollCandidatesResponse> {
  const { symbol, expiration, strike, right, conId, minDTEBeyond } = input;

  const closeContract: Contract = {
    symbol,
    secType: SecType.OPT,
    exchange: "SMART",
    currency: "USD",
    lastTradeDateOrContractMonth: expiration,
    strike,
    right: right === "C" ? OptionType.Call : OptionType.Put,
    multiplier: 100,
    conId,
  };

  const candidates: RollCandidate[] = [];
  let closeLeg: RollCandidatesResponse["closeLeg"] = { conId, bid: 0, ask: 0, mid: 0 };

  const sessionId = `roll-${symbol}-${Date.now()}`;

  await withLiveMarketData(async () => {
    // Fetch close-leg prices
    const closeData = await ibkrService.getMarketData(closeContract);
    const closeBid = closeData?.bid ?? 0;
    const closeAsk = closeData?.ask ?? 0;
    const closeMid = (closeBid + closeAsk) / 2;
    closeLeg = { conId, bid: closeBid, ask: closeAsk, mid: closeMid };

    // Fetch and filter option chain
    const chain = await ibkrService.getOptionChain(symbol);
    const filtered = filterCandidateEntries(chain, strike, expiration, right, minDTEBeyond);

    if (filtered.length === 0) return;

    // Limit to the nearest MAX_EXPIRATIONS expirations to keep the market-data
    // batch manageable (a full chain can be 300+ contracts and would easily
    // exceed the 30s client timeout).
    const MAX_EXPIRATIONS = 5;
    const uniqueExpiries = [...new Set(filtered.map((e) => e.expiration))].sort();
    const nearestExpiries = new Set(uniqueExpiries.slice(0, MAX_EXPIRATIONS));
    const capped = filtered.filter((e) => nearestExpiries.has(e.expiration));

    // Resolve conIds BEFORE the market data batch so getContractDetails runs
    // while TWS is still idle (240 snapshot requests would throttle it if done after).
    const tradingClass = (capped[0].call.tradingClass as string | undefined) ?? symbol;
    const multiplier = Number((capped[0].call.multiplier as number | string | undefined) ?? 100);
    const conIdMap = new Map<string, number>();
    await Promise.all(
      [...nearestExpiries].map(async (expiry) => {
        const resolved = await ibkrService.resolveOptionConIds(symbol, expiry, tradingClass, multiplier);
        for (const [key, conId] of resolved) {
          conIdMap.set(`${expiry}_${key}`, conId);
        }
      }),
    );

    // Reserve market data lines so roll batch doesn't silently compete with
    // the spread stream's persistent subscriptions (Observable fallback path).
    const granted = marketDataLineRegistry.reserve(sessionId, capped.length);
    console.log(`[RollCandidates] ${symbol}: fetching ${capped.length} contracts across ${nearestExpiries.size} expiries (lines granted: ${granted}/${capped.length})`);

    // Extract the correct leg contract (call or put) from each chain entry
    const contracts = capped.map((e) => (right === "C" ? e.call : e.put));
    let marketDataMap: Awaited<ReturnType<typeof ibkrService.getMarketDataBatch>>;
    try {
      marketDataMap = await ibkrService.getMarketDataBatch(contracts);
    } finally {
      marketDataLineRegistry.release(sessionId);
    }

    const today = new Date();
    for (const entry of capped) {
      const contract = right === "C" ? entry.call : entry.put;
      const data = marketDataMap.get(marketDataKey(contract));
      if (!data || !data.bid || !data.ask || data.bid <= 0) continue;

      const { netCredit, netCreditMid } = computeNetCredits(
        data.bid,
        data.ask,
        closeAsk,
        closeBid,
      );

      // Only include positive net credit mid candidates
      if (netCreditMid <= 0) continue;

      const daysToExpiry = getDaysToExpiry(entry.expiration, today);
      const candidateConId = conIdMap.get(`${entry.expiration}_${entry.strike}:${right}`) ?? 0;

      candidates.push({
        conId: candidateConId,
        strike: entry.strike,
        expiration: entry.expiration,
        daysToExpiry,
        bid: data.bid,
        ask: data.ask,
        mid: (data.bid + data.ask) / 2,
        netCredit,
        netCreditMid,
        annualizedReturn: computeRollAnnualizedReturn(netCreditMid, entry.strike, daysToExpiry),
      });
    }
  });

  // Sort by netCreditMid descending
  candidates.sort((a, b) => b.netCreditMid - a.netCreditMid);

  return { closeLeg, candidates };
}
