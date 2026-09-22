import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("../../../services/research/auth.service.js", () => ({
  getOAuthToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { spawn } from "node:child_process";

import { saCommentsAnalyzer } from "../../../services/research/analyzers/sa-comments.analyzer.js";

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
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(MOCK_RESPONSE) }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
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

  it("handles markdown-fenced JSON response from Claude", async () => {
    const fenced = "```json\n" + JSON.stringify(MOCK_RESPONSE) + "\n```";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: fenced }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const result = await saCommentsAnalyzer.analyze({
      articles: [
        {
          title: "AAPL Bull Case",
          comments: [{ content: "Love this stock", likes: 4 }],
        },
      ],
      totalComments: 1,
      symbol: "AAPL",
    });

    expect(result.signal).toBe("bullish");
    expect(result.confidence).toBe(0.7);
    expect(result.summary).toBe(
      "Community sentiment is positive with focus on AI growth catalysts."
    );
    expect(result.details.keyIdeas).toHaveLength(2);
  });
});

describe("saCommentsAnalyzer (claude-cli mode)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  function createMockChild(stdout: string, stderr = "", exitCode = 0) {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write(_chunk: any, _enc: any, cb: any) { cb(); } });

    vi.mocked(spawn).mockReturnValue(child);

    process.nextTick(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", exitCode, null);
    });

    return child;
  }

  const input = {
    articles: [
      { title: "AAPL Bull Case", comments: [{ content: "Love this stock", likes: 4 }] },
    ],
    totalComments: 1,
    symbol: "AAPL",
  };

  it("parses valid JSON from claude stdout", async () => {
    createMockChild(JSON.stringify(MOCK_RESPONSE));

    const result = await saCommentsAnalyzer.analyze(input);

    expect(result.signal).toBe("bullish");
    expect(result.confidence).toBe(0.7);
  });

  it("surfaces CLI failure text written to stdout", async () => {
    // `claude --print` reports its own failures on stdout, not stderr,
    // and exits 1.
    createMockChild(
      "Failed to authenticate. API Error: 401 OAuth access token is invalid.",
      "",
      1
    );

    await expect(saCommentsAnalyzer.analyze(input)).rejects.toThrow(
      "401 OAuth access token is invalid"
    );
  });
});
