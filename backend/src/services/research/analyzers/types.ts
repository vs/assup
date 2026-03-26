import type { AnalysisSignal } from "@assup/shared";

export interface AnalysisOutput {
  signal: AnalysisSignal;
  confidence: number;
  summary: string;
  details: Record<string, unknown>;
}

export interface Analyzer {
  source: string;
  analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput>;
}
