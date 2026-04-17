export type { Analyzer, AnalysisOutput } from "./types.js";
export { registerAnalyzer, getAnalyzer, getAllAnalyzers } from "./registry.js";

import { registerAnalyzer } from "./registry.js";
import { technicalAnalyzer } from "./technical.analyzer.js";
import { eventsAnalyzer } from "./events.analyzer.js";
import { optionsAnalyzer } from "./options.analyzer.js";
import { secFilingsAnalyzer } from "./sec-filings.analyzer.js";
import { socialAnalyzer } from "./social.analyzer.js";
import { macroAnalyzer } from "./macro.analyzer.js";
import { saCommentsAnalyzer } from "./sa-comments.analyzer.js";
import { fundamentalsAnalyzer } from "./fundamentals.analyzer.js";

export function initAnalyzers(): void {
  registerAnalyzer(technicalAnalyzer);
  registerAnalyzer(eventsAnalyzer);
  registerAnalyzer(optionsAnalyzer);
  registerAnalyzer(secFilingsAnalyzer);
  registerAnalyzer(socialAnalyzer);
  registerAnalyzer(saCommentsAnalyzer);
  registerAnalyzer(fundamentalsAnalyzer);
  registerAnalyzer(macroAnalyzer); // Used separately by macro service, not per-ticker analysis
  console.log(
    "Registered analyzers: technical, events, options, sec_filings, social, sa_comments, fundamentals, macro"
  );
}
