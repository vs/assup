import { RSI, MACD, SMA, BollingerBands, ATR } from "technicalindicators";
import type { Analyzer, AnalysisOutput } from "./types.js";
import type { OHLCV } from "../providers/index.js";

interface TechnicalDetails {
  currentPrice: number;
  rsi14: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null } | null;
  sma50: number | null;
  sma200: number | null;
  bollingerBands: { upper: number; middle: number; lower: number } | null;
  atr14: number | null;
  volumeTrend: string;
  volumeRatio: number;
  support: number | null;
  resistance: number | null;
  trend: string;
}

function calculateSupport(ohlcv: OHLCV[], lookback = 20): number | null {
  if (ohlcv.length < lookback) return null;
  const recent = ohlcv.slice(-lookback);
  return Math.min(...recent.map((d) => d.low));
}

function calculateResistance(ohlcv: OHLCV[], lookback = 20): number | null {
  if (ohlcv.length < lookback) return null;
  const recent = ohlcv.slice(-lookback);
  return Math.max(...recent.map((d) => d.high));
}

function classifyVolumeTrend(ohlcv: OHLCV[]): {
  trend: string;
  ratio: number;
} {
  if (ohlcv.length < 21) return { trend: "unknown", ratio: 1 };
  const recent5 = ohlcv.slice(-5).reduce((s, d) => s + d.volume, 0) / 5;
  const avg20 = ohlcv.slice(-21, -1).reduce((s, d) => s + d.volume, 0) / 20;
  const ratio = avg20 > 0 ? recent5 / avg20 : 1;

  if (ratio > 1.5) return { trend: "surging", ratio };
  if (ratio > 1.1) return { trend: "increasing", ratio };
  if (ratio < 0.7) return { trend: "declining", ratio };
  return { trend: "normal", ratio };
}

export const technicalAnalyzer: Analyzer = {
  source: "technical",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const ohlcv = (rawData.ohlcv as OHLCV[] | null) ?? [];
    const currentPrice = (rawData.currentPrice as number | null) ?? 0;

    if (ohlcv.length === 0) {
      return {
        signal: "neutral",
        confidence: 0,
        summary: "No OHLCV data available for technical analysis.",
        details: {},
      };
    }

    const closes = ohlcv.map((d) => d.close);
    const highs = ohlcv.map((d) => d.high);
    const lows = ohlcv.map((d) => d.low);

    // Calculate indicators
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const rsi14 =
      rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const macdLatest =
      macdValues.length > 0 ? macdValues[macdValues.length - 1] : null;

    const sma50Values = SMA.calculate({ values: closes, period: 50 });
    const sma50 =
      sma50Values.length > 0 ? sma50Values[sma50Values.length - 1] : null;

    const sma200Values = SMA.calculate({ values: closes, period: 200 });
    const sma200 =
      sma200Values.length > 0 ? sma200Values[sma200Values.length - 1] : null;

    const bbValues = BollingerBands.calculate({
      values: closes,
      period: 20,
      stdDev: 2,
    });
    const bbLatest =
      bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;

    const atrValues = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });
    const atr14 =
      atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;

    const { trend: volumeTrend, ratio: volumeRatio } =
      classifyVolumeTrend(ohlcv);
    const support = calculateSupport(ohlcv);
    const resistance = calculateResistance(ohlcv);

    // Determine trend
    let trend = "neutral";
    if (sma50 && sma200) {
      if (currentPrice > sma50 && sma50 > sma200) trend = "strong_uptrend";
      else if (currentPrice > sma200) trend = "uptrend";
      else if (currentPrice < sma50 && sma50 < sma200)
        trend = "strong_downtrend";
      else if (currentPrice < sma200) trend = "downtrend";
    }

    // Score signals
    let score = 0;
    const signals: string[] = [];

    if (rsi14 !== null) {
      if (rsi14 < 30) {
        score += 2;
        signals.push(`RSI oversold (${rsi14.toFixed(1)})`);
      } else if (rsi14 < 40) {
        score += 1;
        signals.push(`RSI approaching oversold (${rsi14.toFixed(1)})`);
      } else if (rsi14 > 70) {
        score -= 2;
        signals.push(`RSI overbought (${rsi14.toFixed(1)})`);
      } else if (rsi14 > 60) {
        score -= 1;
        signals.push(`RSI approaching overbought (${rsi14.toFixed(1)})`);
      }
    }

    if (trend === "strong_uptrend") {
      score += 2;
      signals.push("Strong uptrend (price > SMA50 > SMA200)");
    } else if (trend === "uptrend") {
      score += 1;
      signals.push("Uptrend (price > SMA200)");
    } else if (trend === "strong_downtrend") {
      score -= 2;
      signals.push("Strong downtrend (price < SMA50 < SMA200)");
    } else if (trend === "downtrend") {
      score -= 1;
      signals.push("Downtrend (price < SMA200)");
    }

    if (macdLatest?.histogram != null) {
      if (macdLatest.histogram > 0) {
        score += 1;
        signals.push("MACD histogram positive");
      } else {
        score -= 1;
        signals.push("MACD histogram negative");
      }
    }

    if (volumeTrend === "surging") {
      signals.push("Volume surging (1.5x+ avg)");
    } else if (volumeTrend === "declining") {
      signals.push("Volume declining");
    }

    // Determine signal
    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 5, 1);

    const details: TechnicalDetails = {
      currentPrice,
      rsi14,
      macd: macdLatest
        ? {
            macd: macdLatest.MACD ?? null,
            signal: macdLatest.signal ?? null,
            histogram: macdLatest.histogram ?? null,
          }
        : null,
      sma50,
      sma200,
      bollingerBands: bbLatest
        ? {
            upper: bbLatest.upper,
            middle: bbLatest.middle,
            lower: bbLatest.lower,
          }
        : null,
      atr14,
      volumeTrend,
      volumeRatio,
      support,
      resistance,
      trend,
    };

    const summary =
      signals.length > 0
        ? signals.slice(0, 3).join(". ") + "."
        : "Insufficient data for technical signals.";

    return {
      signal,
      confidence,
      summary,
      details: details as unknown as Record<string, unknown>,
    };
  },
};
