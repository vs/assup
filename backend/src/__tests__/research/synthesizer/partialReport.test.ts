import { describe, it, expect } from "vitest";
import { parsePartialReport } from "../../../services/research/synthesizer/partialReport.js";

const full = JSON.stringify({
  recommendation: "wheel",
  confidence: 0.65,
  summary: 'Premium is rich and the "trend" holds.',
  fullReport: "## Recommendation\nSell puts.\n\n## Technical Picture\nRSI 48.",
  companyOverview: { description: "Makes things", sector: "Tech", industry: "Hardware", marketPosition: "Leader" },
});

describe("parsePartialReport", () => {
  it("returns nothing before the object starts", () => {
    expect(parsePartialReport("")).toEqual({});
    expect(parsePartialReport("```json\n")).toEqual({});
  });

  it("parses every field of a complete response", () => {
    expect(parsePartialReport(full)).toEqual({
      recommendation: "wheel",
      confidence: 0.65,
      summary: 'Premium is rich and the "trend" holds.',
      fullReport: "## Recommendation\nSell puts.\n\n## Technical Picture\nRSI 48.",
    });
  });

  it("returns the streamed prefix of a string that is still being written", () => {
    const cut = full.indexOf("Sell puts") + "Sell p".length;
    expect(parsePartialReport(full.slice(0, cut))).toEqual({
      recommendation: "wheel",
      confidence: 0.65,
      summary: 'Premium is rich and the "trend" holds.',
      fullReport: "## Recommendation\nSell p",
    });
  });

  it("does not report a number that may still be growing", () => {
    expect(parsePartialReport('{"recommendation": "buy", "confidence": 0.7')).toEqual({
      recommendation: "buy",
    });
  });

  it("drops a half-written escape sequence at the end of the stream", () => {
    expect(parsePartialReport('{"summary": "line one\\')).toEqual({ summary: "line one" });
    expect(parsePartialReport('{"summary": "caf\\u00')).toEqual({ summary: "caf" });
  });

  it("decodes unicode escapes and keeps raw newlines Claude sometimes emits", () => {
    expect(parsePartialReport('{"summary": "caf\\u00e9\nnext"}')).toEqual({ summary: "café\nnext" });
  });

  it("ignores key-like text inside other string values", () => {
    const text = '{"fullReport": "quoted \\"summary\\": \\"fake\\" text';
    expect(parsePartialReport(text)).toEqual({ fullReport: 'quoted "summary": "fake" text' });
  });

  it("tolerates a markdown fence before the object", () => {
    expect(parsePartialReport('```json\n{"recommendation": "hold", "summary": "Wait')).toEqual({
      recommendation: "hold",
      summary: "Wait",
    });
  });
});
