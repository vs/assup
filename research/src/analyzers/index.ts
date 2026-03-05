export type { Analyzer, AnalysisOutput } from "./types.js";
export { registerAnalyzer, getAnalyzer, getAllAnalyzers } from "./registry.js";

import { registerAnalyzer } from "./registry.js";
import { technicalAnalyzer } from "./technical.analyzer.js";
import { seekingAlphaAnalyzer } from "./seeking-alpha.analyzer.js";

export function initAnalyzers(): void {
  registerAnalyzer(technicalAnalyzer);
  registerAnalyzer(seekingAlphaAnalyzer);
  console.log("Registered analyzers: technical, seeking_alpha");
}
