export type { Collector, CollectedData } from "./types.js";
export { registerCollector, getCollector, getAllCollectors } from "./registry.js";

import { registerCollector } from "./registry.js";
import { technicalCollector } from "./technical.collector.js";
import { seekingAlphaCollector } from "./seeking-alpha.collector.js";

export function initCollectors(): void {
  registerCollector(technicalCollector);
  registerCollector(seekingAlphaCollector);
  console.log("Registered collectors: technical, seeking_alpha");
}
