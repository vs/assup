import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";

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
## Options Landscape (if options data available)
## Catalysts & Risks
## Macro Context (if macro data available)
## Conclusion`;

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

function parseAndValidate(text: string): SynthesizerOutput {
  let parsed: SynthesizerOutput;
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    parsed = JSON.parse(cleaned) as SynthesizerOutput;
  } catch {
    throw new Error(
      `Failed to parse synthesizer JSON output. Raw text (first 500 chars): ${text.slice(0, 500)}`
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

  return parseAndValidate(text);
}

async function synthesizeWithClaude(
  input: SynthesizerInput,
  model: string
): Promise<SynthesizerOutput> {
  const prompt = buildUserPrompt(input);

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
      if (signal) {
        reject(new Error("Claude CLI timed out after 5 minutes"));
      } else if (code !== 0) {
        reject(new Error(`Claude CLI failed: ${err || `exit code ${code}`}`));
      } else {
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
