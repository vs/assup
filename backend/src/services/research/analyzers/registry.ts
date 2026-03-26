import type { Analyzer } from "./types.js";

const analyzers = new Map<string, Analyzer>();

export function registerAnalyzer(analyzer: Analyzer): void {
  analyzers.set(analyzer.source, analyzer);
}

export function getAnalyzer(source: string): Analyzer | undefined {
  return analyzers.get(source);
}

export function getAllAnalyzers(): Analyzer[] {
  return Array.from(analyzers.values());
}
