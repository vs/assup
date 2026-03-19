import { describe, it, expect, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { synthesize } from "../../synthesizer/synthesizer.js";

const validOutput = {
  recommendation: "buy",
  confidence: 0.75,
  summary: "AAPL looks strong based on technicals.",
  fullReport: "## Recommendation\nBuy AAPL based on strong momentum.",
};

const baseInput = {
  symbol: "AAPL",
  analyses: [
    {
      source: "technical",
      signal: "bullish",
      confidence: 0.8,
      summary: "RSI at 32 indicates oversold",
      details: { rsi: 32 },
    },
  ],
};

function setResponse(text: string) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text }],
  });
}

describe("synthesizer", () => {
  it("returns parsed recommendation from valid JSON response", async () => {
    setResponse(JSON.stringify(validOutput));

    const result = await synthesize(baseInput);

    expect(result).toEqual(validOutput);
  });

  it("strips markdown fences from response", async () => {
    setResponse("```json\n" + JSON.stringify(validOutput) + "\n```");

    const result = await synthesize(baseInput);

    expect(result).toEqual(validOutput);
  });

  it("throws on invalid JSON response", async () => {
    setResponse("not valid json at all");

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Failed to parse synthesizer JSON"
    );
  });

  it("throws on invalid recommendation value", async () => {
    setResponse(
      JSON.stringify({ ...validOutput, recommendation: "short" })
    );

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Invalid recommendation"
    );
  });

  it("throws on out-of-range confidence", async () => {
    setResponse(
      JSON.stringify({ ...validOutput, confidence: 1.5 })
    );

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Invalid confidence"
    );
  });

  it("throws on missing summary", async () => {
    setResponse(
      JSON.stringify({ ...validOutput, summary: "" })
    );

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Missing summary or fullReport"
    );
  });

  it("throws on missing fullReport", async () => {
    setResponse(
      JSON.stringify({ ...validOutput, fullReport: "" })
    );

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Missing summary or fullReport"
    );
  });

  it("accepts all valid recommendation values", async () => {
    const validRecs = ["buy", "sell", "wheel", "hold", "avoid"];

    for (const rec of validRecs) {
      setResponse(JSON.stringify({ ...validOutput, recommendation: rec }));
      const result = await synthesize(baseInput);
      expect(result.recommendation).toBe(rec);
    }
  });

  it("passes model parameter to API", async () => {
    setResponse(JSON.stringify(validOutput));

    await synthesize(baseInput, "claude-opus-4-6");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-6" })
    );
  });

  it("includes macro context in prompt when provided", async () => {
    setResponse(JSON.stringify(validOutput));

    const inputWithMacro = {
      ...baseInput,
      macroContext: {
        regime: "expansion",
        summary: "Economy is growing steadily",
        details: { gdp: 2.5 },
      },
    };

    await synthesize(inputWithMacro);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("Macro Context"),
          }),
        ]),
      })
    );
  });
});
