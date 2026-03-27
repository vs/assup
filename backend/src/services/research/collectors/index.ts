export type { Collector, CollectedData } from "./types.js";
export { registerCollector, getCollector, getAllCollectors } from "./registry.js";
export type { OHLCV } from "../providers/types.js";

import { registerCollector } from "./registry.js";
import { technicalCollector } from "./technical.collector.js";
import { seekingAlphaCollector } from "./seeking-alpha.collector.js";
import { eventsCollector } from "./events.collector.js";
import { optionsCollector } from "./options.collector.js";
import { secFilingsCollector } from "./sec-filings.collector.js";
import { shortInterestCollector } from "./short-interest.collector.js";
import { socialCollector } from "./social.collector.js";
import { analystConsensusCollector } from "./analyst-consensus.collector.js";
import { macroCollector } from "./macro.collector.js";
import { saCommentsCollector } from "./sa-comments.collector.js";
import { fundamentalsCollector } from "./fundamentals.collector.js";

export function initCollectors(): void {
  registerCollector(technicalCollector);
  registerCollector(seekingAlphaCollector);
  registerCollector(eventsCollector);
  registerCollector(optionsCollector);
  registerCollector(secFilingsCollector);
  registerCollector(shortInterestCollector);
  registerCollector(socialCollector);
  registerCollector(analystConsensusCollector);
  registerCollector(saCommentsCollector);
  registerCollector(fundamentalsCollector);
  registerCollector(macroCollector); // Used separately by macro service, not per-ticker collection
  console.log(
    "Registered collectors: technical, seeking_alpha, events, options, sec_filings, short_interest, social, analyst_consensus, sa_comments, fundamentals, macro"
  );
}
