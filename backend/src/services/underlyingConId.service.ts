/**
 * Resolves the IBKR conId of an option underlying.
 *
 * getSecDefOptParams needs the underlying's conId, and the obvious way to get
 * it — reqContractDetails on the underlying — does not work for indices: TWS
 * silently drops contract-details requests for index contracts (SPX/XSP/RUT on
 * CBOE/RUSSELL), returning no details, no end marker and no error, so the
 * request promise never settles.
 *
 * reqMatchingSymbols does answer for those symbols and carries the conId, so
 * index underlyings resolve through the symbol search instead. Stocks keep
 * using contract details, which TWS answers normally for SMART routing.
 */

import type { IBApiNext } from "@stoqey/ib";
import { SecType } from "@stoqey/ib";
import { isIndexSymbol } from "../utils/options.js";
import { withTimeout } from "../utils/withTimeout.js";

/** conIds are stable identifiers, so a resolved value is cached for the process lifetime. */
const cache = new Map<string, number>();

const DEFAULT_TIMEOUT_MS = 15_000;

export function clearUnderlyingConIdCache(): void {
  cache.clear();
}

export async function resolveUnderlyingConId(
  api: IBApiNext,
  symbol: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number> {
  const cached = cache.get(symbol);
  if (cached != null) return cached;

  const conId = isIndexSymbol(symbol)
    ? await resolveIndexConId(api, symbol, timeoutMs)
    : await resolveStockConId(api, symbol, timeoutMs);

  cache.set(symbol, conId);
  return conId;
}

async function resolveIndexConId(
  api: IBApiNext,
  symbol: string,
  timeoutMs: number,
): Promise<number> {
  const matches = await withTimeout(
    api.getMatchingSymbols(symbol),
    `getMatchingSymbols(${symbol})`,
    timeoutMs,
  );

  // The search is a prefix match returning unrelated listings (XSP also yields
  // XSPAM), so require the exact symbol and the index security type.
  const match = matches.find(
    (m) =>
      m.contract?.symbol === symbol && m.contract?.secType === SecType.IND,
  );

  if (!match?.contract?.conId) {
    throw new Error(
      `No index contract found for ${symbol} via symbol search. ` +
        `TWS returned ${matches.length} match(es), none of them an ${SecType.IND} contract named ${symbol}.`,
    );
  }

  return match.contract.conId;
}

async function resolveStockConId(
  api: IBApiNext,
  symbol: string,
  timeoutMs: number,
): Promise<number> {
  const details = await withTimeout(
    api.getContractDetails({
      symbol,
      secType: SecType.STK,
      exchange: "SMART",
      currency: "USD",
    }),
    `getContractDetails(${symbol})`,
    timeoutMs,
  );

  const conId = details[0]?.contract?.conId;
  if (conId == null) {
    throw new Error(`No contract details for ${symbol}`);
  }
  return conId;
}
