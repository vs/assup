/**
 * The app-wide QuoteHub, wired to the TWS connection. Every TWS market data
 * request goes through `quoteHub` — see quoteHub.ts for why.
 */

import { ibkrService } from "../ibkr.js";
import { QuoteHub } from "./quoteHub.js";

export const quoteHub = new QuoteHub({
  getApi: () => {
    const api = ibkrService.getApi();
    return api && api.isConnected ? api : null;
  },
  onConnectionChange: (cb) => {
    let connected: boolean | null = null;
    // ibkrService.subscribe replays the current status immediately; only pass on changes
    return ibkrService.subscribe((status) => {
      if (status.connected === connected) return;
      connected = status.connected;
      cb(status.connected);
    });
  },
  maxLines: Number(process.env.IB_MARKET_DATA_LINES ?? 100),
});

export { QuoteHub } from "./quoteHub.js";
export type { QuoteLease, LinePriority } from "./quoteHub.js";
export type { Quote, QuoteContract, QuoteField, QuoteStatus } from "./quoteTypes.js";
export { quoteKey, quotePrice } from "./quoteKey.js";
export { greeksFromQuote } from "./optionGreeks.js";
