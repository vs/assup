import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { getOAuthToken } from "../services/auth.service.js";

interface SynthesizerInput {
  symbol: string;
  analyses: Array<{
    source: string;
    signal: string;
    confidence: number;
    summary: string;
    details: Record<string, unknown>;
  }>;
  macroContext?: {
    regime: string;
    summary: string;
    details: Record<string, unknown>;
  };
}

interface SynthesizerOutput {
  recommendation: string;
  confidence: number;
  summary: string;
  fullReport: string;
}

export type SynthesizerMode = "claude-cli" | "api";

export interface SynthesizeOptions {
  model?: "claude-sonnet-4-6" | "claude-opus-4-6";
  mode?: SynthesizerMode;
}

const SYSTEM_PROMPT = `You are a rigorous financial research analyst. You synthesize data from multiple sources into actionable research reports.

Rules:
- Cite specific data points from the provided analysis (e.g., "RSI at 32 indicates oversold conditions")
- Flag conflicting signals explicitly (e.g., "Technical indicators are bullish but sentiment is bearish")
- Never hallucinate numbers — only reference data provided in the input
- Express uncertainty when sources disagree
- Be concise — every sentence should add information
- Your recommendation must be one of: buy, sell, wheel, hold, avoid
- "wheel" means the stock is suitable for a wheel strategy (selling puts, potentially getting assigned, selling calls)
- Confidence is 0.0 to 1.0 — be conservative, 0.8+ requires strong agreement across multiple sources

Output format (respond with ONLY this JSON, no markdown fences):
{
  "recommendation": "buy|sell|wheel|hold|avoid",
  "confidence": 0.0-1.0,
  "summary": "2-3 sentence executive summary",
  "fullReport": "Full markdown report with sections"
}

The fullReport should have these markdown sections:
## Recommendation
## Technical Picture
## Sentiment & Analyst View
## Bull Case
## Bear Case
## Options Landscape (if options data available)
## Catalysts & Risks
## Macro Context (if macro data available)
## Conclusion

For Bull Case and Bear Case sections:
- Synthesize arguments from ALL available sources (analyst ratings, SA comments, technical signals, options flow, fundamentals)
- Cite specific data points (e.g., "SA commenters highlight 37% CAGR EPS growth", "Revenue growth at 65.4%", "Wall Street consensus: Buy at 4.72")
- Include both consensus and contrarian viewpoints from SA comments when available
- Be specific about price targets, catalysts, and risks mentioned by analysts and commenters
- Each case should have 3-5 bullet points with concrete supporting evidence`;

function buildUserPrompt(input: SynthesizerInput): string {
  let prompt = `Analyze ${input.symbol} and provide a trading recommendation.\n\n`;
  prompt += `### Analysis Data\n\n`;

  for (const a of input.analyses) {
    prompt += `**${a.source}** (signal: ${a.signal}, confidence: ${a.confidence.toFixed(2)})\n`;
    prompt += `Summary: ${a.summary}\n`;
    prompt += `Details: ${JSON.stringify(a.details, null, 2)}\n\n`;
  }

  if (input.macroContext) {
    prompt += `### Macro Context\n`;
    prompt += `Regime: ${input.macroContext.regime}\n`;
    prompt += `Summary: ${input.macroContext.summary}\n`;
    prompt += `Details: ${JSON.stringify(input.macroContext.details, null, 2)}\n\n`;
  }

  prompt += `Provide your research report as JSON.`;
  return prompt;
}

function extractJson(text: string): string {
  // Strip markdown fences
  const fenceStripped = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  // Try the stripped text directly first
  try {
    JSON.parse(fenceStripped);
    return fenceStripped;
  } catch {
    // Fall through to extraction
  }

  // Extract the first top-level JSON object from within surrounding text
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in output");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("No complete JSON object found in output");
}

function parseAndValidate(text: string): SynthesizerOutput {
  let parsed: SynthesizerOutput;
  try {
    parsed = JSON.parse(extractJson(text)) as SynthesizerOutput;
  } catch (e) {
    throw new Error(
      `Failed to parse synthesizer JSON output: ${(e as Error).message}. Raw text (first 500 chars): ${text.slice(0, 500)}`
    );
  }

  const validRecs = ["buy", "sell", "wheel", "hold", "avoid"];
  if (!validRecs.includes(parsed.recommendation)) {
    throw new Error(`Invalid recommendation: ${parsed.recommendation}`);
  }
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error(`Invalid confidence: ${parsed.confidence}`);
  }
  if (!parsed.summary || !parsed.fullReport) {
    throw new Error("Missing summary or fullReport in synthesizer output");
  }

  return parsed;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

async function synthesizeWithSDK(
  input: SynthesizerInput,
  model: "claude-sonnet-4-6" | "claude-opus-4-6" = "claude-sonnet-4-6"
): Promise<SynthesizerOutput> {
  const anthropic = getClient();
  const sources = input.analyses.map((a) => a.source).join(", ");
  console.log(`[Synthesizer] SDK call for ${input.symbol} (model=${model}, sources=${sources})`);
  const start = Date.now();

  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt(input),
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Synthesizer] SDK response for ${input.symbol} in ${elapsed}s (${text.length} chars, usage: ${message.usage.input_tokens}in/${message.usage.output_tokens}out)`);

  return parseAndValidate(text);
}

async function synthesizeWithClaude(
  input: SynthesizerInput,
  model: string
): Promise<SynthesizerOutput> {
  const prompt = buildUserPrompt(input);
  const sources = input.analyses.map((a) => a.source).join(", ");
  console.log(`[Synthesizer] CLI call for ${input.symbol} (model=${model}, sources=${sources}, prompt=${prompt.length} chars)`);
  const start = Date.now();

  const args = [
    "--print",
    "--output-format", "text",
    "--system-prompt", SYSTEM_PROMPT,
    "--model", model,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];

  // Build env without CLAUDECODE to avoid nested-session detection
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // Inject stored OAuth token; remove API key when OAuth is present
  // (API key takes precedence in Claude CLI and would bill per-call)
  const oauthToken = await getOAuthToken();
  if (oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    delete env.ANTHROPIC_API_KEY;
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, {
      env,
      timeout: 5 * 60 * 1000, // 5 minutes
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (data: Buffer) => { out += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { err += data.toString(); });

    child.on("error", (e) => reject(new Error(`Claude CLI failed to start: ${e.message}`)));

    child.on("close", (code, signal) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (err) {
        console.warn(`[Synthesizer] CLI stderr for ${input.symbol}: ${err.slice(0, 500)}`);
      }
      if (signal === "SIGTERM") {
        reject(new Error("Claude CLI timed out after 5 minutes"));
      } else if (signal) {
        reject(new Error(`Claude CLI killed with signal ${signal}`));
      } else if (code !== 0) {
        console.error(`[Synthesizer] CLI failed for ${input.symbol} in ${elapsed}s (exit ${code})`);
        reject(new Error(`Claude CLI failed (exit ${code}): ${err || "(no stderr)"}`));
      } else if (!out.trim()) {
        console.error(`[Synthesizer] CLI returned empty stdout for ${input.symbol} in ${elapsed}s`);
        reject(new Error(`Claude CLI returned empty output. stderr: ${err || "(none)"}`));
      } else {
        console.log(`[Synthesizer] CLI response for ${input.symbol} in ${elapsed}s (${out.length} chars)`);
        resolve(out);
      }
    });

    // Ignore EPIPE — child may exit before consuming stdin;
    // the close event carries the real exit code/error.
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });

  return parseAndValidate(stdout);
}

export async function synthesize(
  input: SynthesizerInput,
  optionsOrModel?: SynthesizeOptions | "claude-sonnet-4-6" | "claude-opus-4-6"
): Promise<SynthesizerOutput> {
  const options: SynthesizeOptions =
    typeof optionsOrModel === "string"
      ? { model: optionsOrModel }
      : optionsOrModel ?? {};

  const mode = options.mode ?? (process.env.SYNTHESIZER_MODE as SynthesizerMode) ?? "claude-cli";
  const model = options.model ?? "claude-sonnet-4-6";

  if (mode === "claude-cli") {
    return synthesizeWithClaude(input, model);
  }
  return synthesizeWithSDK(input, model);
}
