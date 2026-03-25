import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Reset the module-level singleton between tests
// by resetting the module cache
import { saCommentsAnalyzer } from "../../analyzers/sa-comments.analyzer.js";

const MOCK_RESPONSE = {
  signal: "bullish",
  confidence: 0.7,
  summary:
    "Community sentiment is positive with focus on AI growth catalysts.",
  keyIdeas: [
    {
      idea: "AI revenue growth accelerating",
      stance: "bullish",
      mentions: 5,
    },
    {
      idea: "Valuation concerns at current levels",
      stance: "bearish",
      mentions: 2,
    },
  ],
  consensusView: "Broadly bullish on long-term AI thesis",
  contrarianView: "Valuation stretched relative to near-term earnings",
  catalysts: ["Upcoming earnings report", "New product launch"],
  risks: ["Regulatory scrutiny", "Competition from AMD"],
};

describe("saCommentsAnalyzer", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESPONSE) }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });
  });

  it("returns neutral for empty articles / zero comments", async () => {
    const result = await saCommentsAnalyzer.analyze({
      articles: [],
      totalComments: 0,
      symbol: "AAPL",
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
    expect(result.summary).toContain("No Seeking Alpha comments");
    expect(result.details).toEqual({
      keyIdeas: [],
      catalysts: [],
      risks: [],
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns neutral for articles with no comments (totalComments: 0)", async () => {
    const result = await saCommentsAnalyzer.analyze({
      articles: [
        { title: "AAPL is great", comments: [] },
        { title: "AAPL Q4 earnings", comments: [] },
      ],
      totalComments: 0,
      symbol: "AAPL",
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls Claude and returns structured analysis when comments exist", async () => {
    const result = await saCommentsAnalyzer.analyze({
      articles: [
        {
          title: "NVDA AI Growth Story",
          comments: [
            { content: "Great analysis, AI is the future!", likes: 10 },
            { content: "Valuation is too stretched here.", likes: 3 },
          ],
        },
        {
          title: "NVDA Earnings Preview",
          comments: [
            { content: "Expecting a beat on revenue.", likes: 5 },
          ],
        },
      ],
      totalComments: 3,
      symbol: "NVDA",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.signal).toBe("bullish");
    expect(result.confidence).toBe(0.7);
    expect(result.summary).toBe(
      "Community sentiment is positive with focus on AI growth catalysts."
    );
    expect(result.details.keyIdeas).toHaveLength(2);
    expect(result.details.catalysts).toEqual([
      "Upcoming earnings report",
      "New product launch",
    ]);
    expect(result.details.risks).toEqual([
      "Regulatory scrutiny",
      "Competition from AMD",
    ]);
    expect(result.details.articleCount).toBe(2);
    expect(result.details.totalComments).toBe(3);
    expect(result.details.consensusView).toBe(
      "Broadly bullish on long-term AI thesis"
    );
    expect(result.details.contrarianView).toBe(
      "Valuation stretched relative to near-term earnings"
    );
  });
});
