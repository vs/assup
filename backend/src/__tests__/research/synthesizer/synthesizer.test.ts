import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("../../../services/research/db.js", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { spawn } from "node:child_process";

import { synthesize } from "../../../services/research/synthesizer/synthesizer.js";

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
    usage: { input_tokens: 100, output_tokens: 200 },
  });
}

describe("synthesizer", () => {
  beforeAll(() => {
    process.env.SYNTHESIZER_MODE = "api";
  });
  afterAll(() => {
    delete process.env.SYNTHESIZER_MODE;
  });

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

describe("synthesizeWithClaude (claude-cli mode)", () => {
  beforeAll(() => {
    process.env.SYNTHESIZER_MODE = "claude-cli";
  });

  afterAll(() => {
    delete process.env.SYNTHESIZER_MODE;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockChild(
    stdout: string,
    stderr = "",
    exitCode = 0,
    signal: string | null = null
  ) {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write(_chunk: any, _enc: any, cb: any) { cb(); } });

    vi.mocked(spawn).mockReturnValue(child);

    // Emit data and close on next tick
    process.nextTick(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", exitCode, signal);
    });

    return child;
  }

  it("parses valid JSON from claude stdout", async () => {
    createMockChild(JSON.stringify(validOutput));

    const result = await synthesize(baseInput);

    expect(result).toEqual(validOutput);
  });

  it("strips markdown fences from claude output", async () => {
    createMockChild("```json\n" + JSON.stringify(validOutput) + "\n```");

    const result = await synthesize(baseInput);

    expect(result).toEqual(validOutput);
  });

  it("throws on non-zero exit code", async () => {
    createMockChild("", "Something went wrong", 1);

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Claude CLI failed (exit 1): Something went wrong"
    );
  });

  it("throws on invalid JSON from claude", async () => {
    createMockChild("This is not JSON at all");

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Failed to parse synthesizer JSON"
    );
  });

  it("throws on timeout (SIGTERM)", async () => {
    createMockChild("", "", 0, "SIGTERM");

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Claude CLI timed out after 5 minutes"
    );
  });

  it("throws on spawn error", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write(_chunk: any, _enc: any, cb: any) { cb(); } });

    vi.mocked(spawn).mockReturnValue(child);

    process.nextTick(() => {
      child.emit("error", new Error("ENOENT: claude not found"));
    });

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Claude CLI failed to start: ENOENT: claude not found"
    );
  });

  it("passes system prompt and model to claude args", async () => {
    createMockChild(JSON.stringify(validOutput));

    await synthesize(baseInput, { model: "claude-opus-4-6" });

    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "--system-prompt",
        expect.stringContaining("rigorous financial research analyst"),
        "--model",
        "claude-opus-4-6",
      ]),
      expect.any(Object)
    );
  });

  it("unsets CLAUDECODE env var in child process", async () => {
    process.env.CLAUDECODE = "true";
    try {
      createMockChild(JSON.stringify(validOutput));

      await synthesize(baseInput);

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const spawnOptions = spawnCall[2] as any;
      expect(spawnOptions.env).toBeDefined();
      expect(spawnOptions.env.CLAUDECODE).toBeUndefined();
    } finally {
      delete process.env.CLAUDECODE;
    }
  });

  it("writes prompt to stdin", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    const writtenChunks: string[] = [];
    child.stdin = new Writable({
      write(chunk: any, _enc: any, cb: any) {
        writtenChunks.push(chunk.toString());
        cb();
      },
    });

    vi.mocked(spawn).mockReturnValue(child);

    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify(validOutput)));
      child.emit("close", 0, null);
    });

    await synthesize(baseInput);

    const written = writtenChunks.join("");
    expect(written).toContain("Analyze AAPL");
    expect(written).toContain("RSI at 32 indicates oversold");
  });
});
