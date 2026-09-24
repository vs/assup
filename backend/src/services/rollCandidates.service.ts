/**
 * Roll Candidates Service
 * Finds roll opportunities for a short option position: any strike within a band
 * around the current one, at a later expiry. Rolling out at the same or a more
 * aggressive strike usually pays the most premium, so both directions are
 * scanned, and rolls that cost money (a debit) are returned too — the caller
 * decides whether the loss is worth it.
 */

import type { Contract } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import type { OptionChainEntry } from "./ibkr.js";
import { quoteHub, quoteKey, summarizeStatuses, type QuoteContract } from "./quotes/index.js";
import { getDaysToExpiry } from "../utils/options.js";
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
 * - Strike within ±strikeRangePercent of the current strike (either direction,
 *   including the current strike itself — rolling out at the same strike is the
 *   classic roll and usually the best credit)
 * - Expiry at least minDTEBeyond calendar days after currentExpiration
 *
 * `right` doesn't restrict strikes; the caller quotes the same right it holds.
 */
export function filterCandidateEntries(
  chain: OptionChainEntry[],
  currentStrike: number,
  currentExpiration: string,
  right: "C" | "P",
  minDTEBeyond: number,
  strikeRangePercent: number,
): OptionChainEntry[] {
  const currentExpiryDate = parseExpirationDate(currentExpiration);
  const minMs = minDTEBeyond * 24 * 60 * 60 * 1000;
  const minStrike = currentStrike * (1 - strikeRangePercent / 100);
  const maxStrike = currentStrike * (1 + strikeRangePercent / 100);

  return chain.filter((entry) => {
    if (entry.strike < minStrike || entry.strike > maxStrike) return false;

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
  signal?: AbortSignal,
): Promise<RollCandidatesResponse> {
  const { symbol, expiration, strike, right, conId, minDTEBeyond, strikeRangePercent } = input;

  // Quote the position being closed first: without its price every "net credit"
  // would really be the new leg's full premium, so there's no point scanning.
  const closeContract: QuoteContract = {
    conId,
    symbol,
    secType: "OPT",
    lastTradeDateOrContractMonth: expiration,
    strike,
    right,
    multiplier: 100,
  };
  const closeQuote = (await quoteHub.get([closeContract], { fields: ["bid", "ask"], signal }))
    .get(quoteKey(closeContract));
  if (!closeQuote || closeQuote.status !== "ok" || closeQuote.bid === undefined || closeQuote.ask === undefined || closeQuote.ask <= 0) {
    throw new Error(
      `No quote from TWS for ${symbol} ${expiration} ${strike}${right} (the position being rolled): ` +
        `${closeQuote ? summarizeStatuses([closeQuote]) : "not returned"}. The roll's net credit can't be computed. ` +
        `Check that the options market is open and your IBKR options market data subscription covers ${symbol}, then re-scan.`,
    );
  }
  const closeBid = closeQuote.bid;
  const closeAsk = closeQuote.ask;
  const closeLeg: RollCandidatesResponse["closeLeg"] = { conId, bid: closeBid, ask: closeAsk, mid: (closeBid + closeAsk) / 2 };

  const chain = await ibkrService.getOptionChain(symbol);
  const filtered = filterCandidateEntries(chain, strike, expiration, right, minDTEBeyond, strikeRangePercent);
  if (filtered.length === 0) return { closeLeg, candidates: [] };

  // Limit to the nearest MAX_EXPIRATIONS expirations to keep the quote batch
  // manageable (a full chain can be 300+ contracts).
  const MAX_EXPIRATIONS = 5;
  const uniqueExpiries = [...new Set(filtered.map((e) => e.expiration))].sort();
  const nearestExpiries = new Set(uniqueExpiries.slice(0, MAX_EXPIRATIONS));
  const capped = filtered.filter((e) => nearestExpiries.has(e.expiration));

  // Look up the contracts actually listed per expiry. The chain is the cross
  // product of all strikes × expirations, so many of its entries don't exist
  // (ZAG: 206 strikes, ~53 listed per expiry). TWS paces contract-details
  // requests (~5s each), so query expirations one at a time — in parallel they
  // queue up and time out.
  const tradingClass = (capped[0].call.tradingClass as string | undefined) ?? symbol;
  const multiplier = Number((capped[0].call.multiplier as number | string | undefined) ?? 100);
  const wanted = new Set(capped.map((e) => `${e.expiration}_${e.strike}`));
  const contracts: Contract[] = [];
  for (const expiry of nearestExpiries) {
    const listed = await ibkrService.getOptionContracts(symbol, expiry, tradingClass, multiplier, right);
    for (const c of listed) {
      if (wanted.has(`${c.lastTradeDateOrContractMonth}_${c.strike}`)) contracts.push(c);
    }
  }
  if (contracts.length === 0) return { closeLeg, candidates: [] };

  const quotes = await quoteHub.get(contracts as QuoteContract[], { fields: ["bid", "ask"], signal });
  console.log(`[RollCandidates] ${symbol}: quoted ${contracts.length} listed contracts across ${nearestExpiries.size} expiries (${summarizeStatuses(quotes.values())})`);
  if (![...quotes.values()].some((q) => q.bid !== undefined && q.ask !== undefined)) {
    throw new Error(
      `No quotes from TWS for any of ${contracts.length} ${symbol} roll candidates (${summarizeStatuses(quotes.values())}).`,
    );
  }

  const candidates: RollCandidate[] = [];
  const today = new Date();
  for (const contract of contracts) {
    const data = quotes.get(quoteKey(contract as QuoteContract));
    if (!data || data.bid === undefined || data.ask === undefined || data.bid <= 0 || data.ask <= 0) continue;

    const { netCredit, netCreditMid } = computeNetCredits(data.bid, data.ask, closeAsk, closeBid);

    const candidateExpiration = contract.lastTradeDateOrContractMonth!;
    const candidateStrike = contract.strike!;
    const daysToExpiry = getDaysToExpiry(candidateExpiration, today);

    candidates.push({
      conId: contract.conId!,
      strike: candidateStrike,
      expiration: candidateExpiration,
      daysToExpiry,
      bid: data.bid,
      ask: data.ask,
      mid: (data.bid + data.ask) / 2,
      netCredit,
      netCreditMid,
      annualizedReturn: computeRollAnnualizedReturn(netCreditMid, candidateStrike, daysToExpiry),
    });
  }

  // Sort by netCreditMid descending: best credit first, debit rolls last
  candidates.sort((a, b) => b.netCreditMid - a.netCreditMid);

  return { closeLeg, candidates };
}
