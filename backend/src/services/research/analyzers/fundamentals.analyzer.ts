import type { Analyzer, AnalysisOutput } from "./types.js";

interface Fundamentals {
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  epsGrowth: number | null;
  dividendYield: number | null;
  revenue: number | null;
  marketCap: number | null;
  beta: number | null;
  roe: number | null;
  debtToEquity: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
}

interface Volatility {
  historical30d: number | null;
  implied: number | null;
}

interface OptionActivity {
  callVolume: number | null;
  putVolume: number | null;
  callOI: number | null;
  putOI: number | null;
  putCallRatio: number | null;
}

export const fundamentalsAnalyzer: Analyzer = {
  source: "fundamentals",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const fundamentals = (rawData.fundamentals as Fundamentals) ?? {};
    const volatility = (rawData.volatility as Volatility) ?? {};
    const optionActivity = (rawData.optionActivity as OptionActivity) ?? {};

    let score = 0;
    const signals: string[] = [];
    let dataPoints = 0;

    // --- Value assessment ---
    if (fundamentals.pe !== null) {
      dataPoints++;
      if (fundamentals.pe > 0 && fundamentals.pe < 15) {
        score += 1;
        signals.push(`Attractive P/E: ${fundamentals.pe.toFixed(1)}`);
      } else if (fundamentals.pe > 40) {
        score -= 1;
        signals.push(`Elevated P/E: ${fundamentals.pe.toFixed(1)}`);
      } else if (fundamentals.pe > 0) {
        signals.push(`P/E: ${fundamentals.pe.toFixed(1)}`);
      } else if (fundamentals.pe < 0) {
        score -= 1;
        signals.push("Negative earnings (P/E N/A)");
      }
    }

    if (fundamentals.epsGrowth !== null) {
      dataPoints++;
      if (fundamentals.epsGrowth > 20) {
        score += 1;
        signals.push(`Strong EPS growth: ${fundamentals.epsGrowth.toFixed(1)}%`);
      } else if (fundamentals.epsGrowth < -10) {
        score -= 1;
        signals.push(`EPS declining: ${fundamentals.epsGrowth.toFixed(1)}%`);
      }
    }

    if (fundamentals.revenueGrowth !== null) {
      dataPoints++;
      if (fundamentals.revenueGrowth > 15) {
        score += 1;
        signals.push(`Strong revenue growth: ${fundamentals.revenueGrowth.toFixed(1)}%`);
      } else if (fundamentals.revenueGrowth < -5) {
        score -= 1;
        signals.push(`Revenue declining: ${fundamentals.revenueGrowth.toFixed(1)}%`);
      }
    }

    // --- Quality assessment ---
    if (fundamentals.roe !== null) {
      dataPoints++;
      if (fundamentals.roe > 20) {
        score += 1;
        signals.push(`High ROE: ${fundamentals.roe.toFixed(1)}%`);
      } else if (fundamentals.roe < 5 && fundamentals.roe >= 0) {
        score -= 1;
        signals.push(`Low ROE: ${fundamentals.roe.toFixed(1)}%`);
      }
    }

    if (fundamentals.profitMargin !== null) {
      dataPoints++;
      if (fundamentals.profitMargin > 20) {
        score += 1;
        signals.push(`Strong profit margin: ${fundamentals.profitMargin.toFixed(1)}%`);
      } else if (fundamentals.profitMargin < 0) {
        score -= 1;
        signals.push(`Negative profit margin: ${fundamentals.profitMargin.toFixed(1)}%`);
      }
    }

    if (fundamentals.debtToEquity !== null) {
      dataPoints++;
      if (fundamentals.debtToEquity > 200) {
        score -= 1;
        signals.push(`High debt/equity: ${fundamentals.debtToEquity.toFixed(0)}%`);
      } else if (fundamentals.debtToEquity < 50) {
        score += 1;
        signals.push(`Conservative debt/equity: ${fundamentals.debtToEquity.toFixed(0)}%`);
      }
    }

    // --- IV vs HV comparison ---
    if (volatility.implied !== null && volatility.historical30d !== null && volatility.historical30d > 0) {
      dataPoints++;
      const ivHvRatio = volatility.implied / volatility.historical30d;
      if (ivHvRatio > 1.3) {
        signals.push(
          `IV premium: IV ${(volatility.implied * 100).toFixed(0)}% vs HV ${(volatility.historical30d * 100).toFixed(0)}% (${((ivHvRatio - 1) * 100).toFixed(0)}% premium) — options overpriced`
        );
      } else if (ivHvRatio < 0.8) {
        signals.push(
          `IV discount: IV ${(volatility.implied * 100).toFixed(0)}% vs HV ${(volatility.historical30d * 100).toFixed(0)}% — options may be cheap`
        );
      } else {
        signals.push(
          `IV/HV in line: IV ${(volatility.implied * 100).toFixed(0)}% vs HV ${(volatility.historical30d * 100).toFixed(0)}%`
        );
      }
    }

    // --- Put/call sentiment ---
    if (optionActivity.putCallRatio !== null) {
      dataPoints++;
      if (optionActivity.putCallRatio > 1.5) {
        score -= 1;
        signals.push(`Elevated put/call ratio: ${optionActivity.putCallRatio.toFixed(2)} — bearish options flow`);
      } else if (optionActivity.putCallRatio < 0.5) {
        score += 1;
        signals.push(`Low put/call ratio: ${optionActivity.putCallRatio.toFixed(2)} — bullish options flow`);
      } else {
        signals.push(`Put/call ratio: ${optionActivity.putCallRatio.toFixed(2)}`);
      }
    }

    // Early return for insufficient data
    if (dataPoints === 0) {
      return {
        signal: "neutral",
        confidence: 0.1,
        summary: "Insufficient fundamental data for analysis.",
        details: { fundamentals, volatility, optionActivity },
      };
    }

    // Determine signal
    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    // Confidence scales with both signal strength and data availability
    const maxDataPoints = 9;
    const dataRatio = Math.min(dataPoints / maxDataPoints, 1);
    const confidence = Math.min(Math.abs(score) / 5, 1) * (0.5 + 0.5 * dataRatio);

    return {
      signal,
      confidence: Math.max(confidence, 0.1),
      summary: signals.join(". ") + ".",
      details: {
        score,
        dataPoints,
        fundamentals,
        volatility,
        optionActivity,
        sector: rawData.sector,
        companyName: rawData.companyName,
        stockType: rawData.stockType,
      },
    };
  },
};
