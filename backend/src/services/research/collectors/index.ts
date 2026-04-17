export type { Collector, CollectedData } from "./types.js";
export { registerCollector, getCollector, getAllCollectors } from "./registry.js";
export type { OHLCV } from "../providers/types.js";

import { registerCollector } from "./registry.js";
import { technicalCollector } from "./technical.collector.js";
import { eventsCollector } from "./events.collector.js";
import { optionsCollector } from "./options.collector.js";
import { secFilingsCollector } from "./sec-filings.collector.js";
import { socialCollector } from "./social.collector.js";
import { macroCollector } from "./macro.collector.js";
import { saCommentsCollector } from "./sa-comments.collector.js";
import { fundamentalsCollector } from "./fundamentals.collector.js";

export function initCollectors(): void {
  registerCollector(technicalCollector);
  registerCollector(eventsCollector);
  registerCollector(optionsCollector);
  registerCollector(secFilingsCollector);
  registerCollector(socialCollector);
  registerCollector(saCommentsCollector);
  registerCollector(fundamentalsCollector);
  registerCollector(macroCollector); // Used separately by macro service, not per-ticker collection
  console.log(
    "Registered collectors: technical, events, options, sec_filings, social, sa_comments, fundamentals, macro"
  );
}
