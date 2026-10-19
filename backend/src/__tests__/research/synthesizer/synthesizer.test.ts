import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const { mockStream } = vi.hoisted(() => ({
  mockStream: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { stream: mockStream };
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
  companyOverview: {
    description: "Apple designs, manufactures, and markets consumer electronics, software, and services worldwide.",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketPosition: "Global leader",
  },
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

/** Fake MessageStream: replays `text` in two chunks to "text" listeners, then resolves. */
function setResponse(text: string) {
  mockStream.mockImplementation(() => {
    const listeners: Array<(delta: string, snapshot: string) => void> = [];
    const stream = {
      on(event: string, cb: (delta: string, snapshot: string) => void) {
        if (event === "text") listeners.push(cb);
        return stream;
      },
      async finalMessage() {
        const mid = Math.floor(text.length / 2);
        for (const cb of listeners) {
          cb(text.slice(0, mid), text.slice(0, mid));
          cb(text.slice(mid), text);
        }
        return {
          content: [{ type: "text", text }],
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      },
    };
    return stream;
  });
}

describe("synthesizer", () => {
  beforeAll(() => {
    process.env.SYNTHESIZER_MODE = "api";
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterAll(() => {
    delete process.env.SYNTHESIZER_MODE;
    delete process.env.ANTHROPIC_API_KEY;
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
      "No JSON object found in output"
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

  it("defaults companyOverview to null when missing from response", async () => {
    const outputWithoutOverview = {
      recommendation: "buy",
      confidence: 0.75,
      summary: "AAPL looks strong.",
      fullReport: "## Recommendation\nBuy.",
    };
    setResponse(JSON.stringify(outputWithoutOverview));

    const result = await synthesize(baseInput);

    expect(result.companyOverview).toBeNull();
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

    expect(mockStream).toHaveBeenCalledWith(
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

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("Macro Context"),
          }),
        ]),
      })
    );
  });

  it("reports the accumulated text while the response streams", async () => {
    const text = JSON.stringify(validOutput);
    setResponse(text);
    const seen: string[] = [];

    await synthesize(baseInput, { onPartialText: (t) => seen.push(t) });

    expect(seen).toEqual([text.slice(0, Math.floor(text.length / 2)), text]);
  });
});

/** Encode `text` the way `claude --print --output-format stream-json --include-partial-messages` emits it. */
function streamJson(text: string, chunks = 3): string {
  const size = Math.ceil(text.length / chunks);
  const lines: unknown[] = [{ type: "system", subtype: "init" }];
  for (let i = 0; i < text.length; i += size) {
    lines.push({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + size) } },
    });
  }
  lines.push({ type: "result", subtype: "success", is_error: false, result: text });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

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
    createMockChild(streamJson(JSON.stringify(validOutput)));

    const result = await synthesize(baseInput);

    expect(result).toEqual(validOutput);
  });

  it("strips markdown fences from claude output", async () => {
    createMockChild(streamJson("```json\n" + JSON.stringify(validOutput) + "\n```"));

    const result = await synthesize(baseInput);

    expect(result).toEqual(validOutput);
  });

  it("throws on non-zero exit code", async () => {
    createMockChild("", "Something went wrong", 1);

    await expect(synthesize(baseInput)).rejects.toThrow(
      "Claude CLI failed (exit 1): Something went wrong"
    );
  });

  it("surfaces CLI failure text written to stdout", async () => {
    // `claude --print` writes its failure message to stdout, not stderr,
    // and exits 1 — see the OAuth failure this reproduces.
    createMockChild(
      "Failed to authenticate. API Error: 401 OAuth access token is invalid.",
      "",
      1
    );

    await expect(synthesize(baseInput)).rejects.toThrow(
      "401 OAuth access token is invalid"
    );
  });

  it("throws on invalid JSON from claude", async () => {
    createMockChild(streamJson("This is not JSON at all"));

    await expect(synthesize(baseInput)).rejects.toThrow(
      "No JSON object found in output"
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
    createMockChild(streamJson(JSON.stringify(validOutput)));

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
      createMockChild(streamJson(JSON.stringify(validOutput)));

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
      child.stdout.emit("data", Buffer.from(streamJson(JSON.stringify(validOutput))));
      child.emit("close", 0, null);
    });

    await synthesize(baseInput);

    const written = writtenChunks.join("");
    expect(written).toContain("Analyze AAPL");
    expect(written).toContain("RSI at 32 indicates oversold");
  });

  it("streams partial text even when stdout chunks split JSON lines", async () => {
    const text = JSON.stringify(validOutput);
    const encoded = streamJson(text, 4);
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write(_chunk: any, _enc: any, cb: any) { cb(); } });
    vi.mocked(spawn).mockReturnValue(child);

    process.nextTick(() => {
      // Deliver stdout in 7-byte pieces so every line arrives fragmented
      for (let i = 0; i < encoded.length; i += 7) {
        child.stdout.emit("data", Buffer.from(encoded.slice(i, i + 7)));
      }
      child.emit("close", 0, null);
    });

    const seen: string[] = [];
    const result = await synthesize(baseInput, { onPartialText: (t) => seen.push(t) });

    expect(result).toEqual(validOutput);
    expect(seen).toHaveLength(4);
    expect(seen[seen.length - 1]).toBe(text);
    expect(text.startsWith(seen[0])).toBe(true);
  });

  it("surfaces an error result reported inside the stream", async () => {
    const lines = [
      { type: "system", subtype: "init" },
      { type: "result", subtype: "error_during_execution", is_error: true, result: "Usage limit reached" },
    ];
    createMockChild(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "", 1);

    await expect(synthesize(baseInput)).rejects.toThrow("Usage limit reached");
  });

  it("starts the CLI streaming, without MCP servers or tools", async () => {
    createMockChild(streamJson(JSON.stringify(validOutput)));

    await synthesize(baseInput);

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining([
      "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--strict-mcp-config",
    ]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
});
