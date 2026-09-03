/**
 * WHT Reversal Matching.
 *
 * Pure function. Given all FLEX withholding-tax CashTransaction rows
 * (any year, any symbol), pairs reversal/cancel entries to their originals
 * and marks each row's status. Used by taxCalculation.service to net
 * cross-date WHT reversals that the existing (symbol, date) aggregation
 * cannot match.
 */

export interface WhtRow {
  transactionId: string;
  symbol: string;            // "" for broker-interest WHT
  description: string;
  amount: number;            // negative for original WHT, positive for reversal
  transactionDate: Date;
  currency: string;
}

export type WhtStatus =
  | "original-paired"
  | "original-unpaired"
  | "reversed"
  | "unpaired";

export interface WhtPairing {
  originalTxnId: string;
  reversedTxnId: string;
  matchKey: string;
}

export interface WhtReversalResult {
  statusByTxnId: Map<string, WhtStatus>;
  pairings: WhtPairing[];
}

const REVERSAL_KEYWORDS = /\b(REVERSAL|CANCEL|CANCELED|CANCELLED|REVERSED)\b/i;
const PER_SHARE_RE = /USD\s+([\d.]+)\s+PER\s+SHARE/i;
const PERIOD_TAG_RE = /FOR\s+([A-Z]{3}-\d{4})/i;

function makeMatchKey(row: WhtRow): string | null {
  if (row.symbol) {
    const m = row.description.match(PER_SHARE_RE);
    const perShare = m ? m[1] : "?";
    return `TICKER:${row.symbol}:${perShare}:${row.currency}`;
  }
  const m = row.description.match(PERIOD_TAG_RE);
  if (!m) return null;
  return `BROKER:${m[1]}:${row.currency}`;
}

function isReversalDescription(description: string): boolean {
  return REVERSAL_KEYWORDS.test(description);
}

export function matchWhtReversals(rows: WhtRow[]): WhtReversalResult {
  const statusByTxnId = new Map<string, WhtStatus>();
  const pairings: WhtPairing[] = [];

  // Bucket rows by matchKey.
  const byKey = new Map<string, WhtRow[]>();
  for (const r of rows) {
    const key = makeMatchKey(r);
    if (!key) {
      statusByTxnId.set(r.transactionId, "unpaired");
      continue;
    }
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  for (const [key, group] of byKey) {
    // Sort by date ASC for deterministic iteration order.
    group.sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
    const used = new Set<string>();

    for (const r of group) {
      if (used.has(r.transactionId)) continue;
      const reversal = isReversalDescription(r.description) || r.amount > 0;
      if (!reversal) continue;
      // Find the un-paired negative-amount row with matching magnitude that is
      // closest in date. Don't constrain to "before" — IBKR sometimes posts
      // the cancel entry back-dated to the original's transaction date, and
      // same-date sort order between original and reversal is non-deterministic.
      let bestMatch: WhtRow | null = null;
      let bestDateDiff = Infinity;
      for (const cand of group) {
        if (cand.transactionId === r.transactionId) continue;
        if (used.has(cand.transactionId)) continue;
        if (cand.amount >= 0) continue;
        if (Math.abs(cand.amount + r.amount) > 0.01) continue;
        const diff = Math.abs(
          cand.transactionDate.getTime() - r.transactionDate.getTime()
        );
        if (diff < bestDateDiff) {
          bestMatch = cand;
          bestDateDiff = diff;
        }
      }
      if (bestMatch) {
        statusByTxnId.set(bestMatch.transactionId, "original-paired");
        statusByTxnId.set(r.transactionId, "reversed");
        used.add(bestMatch.transactionId);
        used.add(r.transactionId);
        pairings.push({
          originalTxnId: bestMatch.transactionId,
          reversedTxnId: r.transactionId,
          matchKey: key,
        });
      } else {
        statusByTxnId.set(r.transactionId, "unpaired");
        used.add(r.transactionId);
      }
    }

    // Anything left over in this group is an unpaired original.
    for (const r of group) {
      if (statusByTxnId.has(r.transactionId)) continue;
      statusByTxnId.set(r.transactionId, "original-unpaired");
    }
  }

  return { statusByTxnId, pairings };
}
