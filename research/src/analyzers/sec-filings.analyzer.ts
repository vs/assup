import type { Analyzer, AnalysisOutput } from "./types.js";

interface FilingEntry {
  id: string;
  fileDate: string;
  formType: string;
  entityName: string;
  periodOfReport: string | null;
}

function classifyActivityLevel(count90d: number): "low" | "moderate" | "high" {
  if (count90d >= 10) return "high";
  if (count90d >= 4) return "moderate";
  return "low";
}

export const secFilingsAnalyzer: Analyzer = {
  source: "sec_filings",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const filingCount30d = (rawData.filingCount30d as number) ?? 0;
    const filingCount90d = (rawData.filingCount90d as number) ?? 0;
    const recentFilings = (rawData.recentFilings as FilingEntry[]) ?? [];

    const insiderActivityLevel = classifyActivityLevel(filingCount90d);

    // Without buy/sell detail from EDGAR search, we stay conservative.
    // High insider activity is notable but direction is unknown,
    // so the signal remains neutral with informational context.
    let signal: "bullish" | "bearish" | "neutral" = "neutral";
    let confidence = 0;
    const signals: string[] = [];

    if (insiderActivityLevel === "high") {
      signal = "neutral";
      confidence = 0.3;
      signals.push(
        `High insider activity: ${filingCount90d} Form 4 filings in 90 days (${filingCount30d} in last 30 days)`
      );
      signals.push("Direction unknown — review individual filings for buy/sell detail");
    } else if (insiderActivityLevel === "moderate") {
      signal = "neutral";
      confidence = 0.2;
      signals.push(
        `Moderate insider activity: ${filingCount90d} Form 4 filings in 90 days (${filingCount30d} in last 30 days)`
      );
    } else {
      signal = "neutral";
      confidence = 0.1;
      signals.push(
        filingCount90d === 0
          ? "No Form 4 filings found in the last 90 days"
          : `Low insider activity: ${filingCount90d} Form 4 filing(s) in 90 days`
      );
    }

    const summary =
      signals.length > 0 ? signals.join(". ") + "." : "No SEC filing data available.";

    return {
      signal,
      confidence,
      summary,
      details: {
        filingCount30d,
        filingCount90d,
        recentFilings: recentFilings.slice(0, 10),
        insiderActivityLevel,
      },
    };
  },
};
