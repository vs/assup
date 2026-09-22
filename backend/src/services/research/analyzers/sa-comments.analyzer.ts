import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { getOAuthToken } from "../auth.service.js";
import type { Analyzer, AnalysisOutput } from "./types.js";

const ANALYSIS_PROMPT = `You are analyzing Seeking Alpha article comments for investment insights.

Given the article titles and community comments below, extract:
1. Key investment ideas and arguments (bull and bear cases)
2. Consensus vs contrarian views
3. Specific catalysts and risks mentioned
4. Overall community sentiment

Respond with ONLY this JSON (no markdown fences):
{
  "signal": "bullish|bearish|neutral",
  "confidence": 0.0-1.0,
  "summary": "2-3 sentence summary of community sentiment and key ideas",
  "keyIdeas": [{"idea": "description", "stance": "bullish|bearish|neutral", "mentions": count}],
  "consensusView": "what most commenters agree on",
  "contrarianView": "notable dissenting opinions",
  "catalysts": ["upcoming events or drivers mentioned"],
  "risks": ["concerns or risks mentioned"]
}

Rules:
- Only cite ideas actually present in the comments
- Confidence: 0.3-0.5 for few comments, 0.5-0.8 for many with clear consensus, 0.8+ only for overwhelming agreement
- Be specific — quote or paraphrase actual comment content
- If comments are low quality or off-topic, reduce confidence`;

interface ArticleData {
  title?: string;
  comments?: Array<{ content?: string; likes?: number }>;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Build the diagnostic for a failed `claude --print` run.
 *
 * Claude CLI reports its own failures (expired OAuth token, usage limit,
 * unknown model) on stdout and exits non-zero, leaving stderr empty — so
 * reporting stderr alone yields "(no stderr)" and hides the actual cause.
 */
function cliFailureDetail(stdout: string, stderr: string): string {
  const parts = [stderr.trim(), stdout.trim()].filter(Boolean);
  if (parts.length === 0) return "(no output)";
  return parts.join(" | ").slice(0, 1000);
}

async function callClaudeViaCLI(
  systemPrompt: string,
  userPrompt: string,
  model = "claude-sonnet-4-6"
): Promise<string> {
  const args = [
    "--print",
    "--output-format", "text",
    "--system-prompt", systemPrompt,
    "--model", model,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const oauthToken = await getOAuthToken();
  if (oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    delete env.ANTHROPIC_API_KEY;
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, {
      env,
      timeout: 3 * 60 * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (data: Buffer) => { out += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { err += data.toString(); });

    child.on("error", (e) => reject(new Error(`Claude CLI failed to start: ${e.message}`)));

    child.on("close", (code, signal) => {
      if (signal === "SIGTERM") {
        reject(new Error("Claude CLI timed out"));
      } else if (signal) {
        reject(new Error(`Claude CLI killed with signal ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`Claude CLI failed (exit ${code}): ${cliFailureDetail(out, err)}`));
      } else if (!out.trim()) {
        reject(new Error(`Claude CLI returned empty output. stderr: ${err || "(none)"}`));
      } else {
        resolve(out);
      }
    });

    child.stdin.on("error", () => {});
    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}

function extractJson(text: string): string {
  // Strip markdown fences (handle leading/trailing whitespace)
  const fenceStripped = text.replace(/^\s*```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "");

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

function buildUserPrompt(
  articles: ArticleData[],
  symbol: string,
  totalComments: number
): string {
  let prompt = `Analyze Seeking Alpha comments for ${symbol} (${totalComments} total comments across ${articles.length} articles).\n\n`;

  for (const article of articles) {
    const title = article.title || "Untitled";
    prompt += `### ${title}\n`;
    const comments = article.comments || [];
    if (comments.length === 0) {
      prompt += "(no comments)\n\n";
      continue;
    }
    for (const comment of comments) {
      const content = (comment.content || "").slice(0, 500);
      const likes = comment.likes ?? 0;
      prompt += `- [${likes} likes] ${content}\n`;
    }
    prompt += "\n";
  }

  prompt += "Provide your analysis as JSON.";
  return prompt;
}

export const saCommentsAnalyzer: Analyzer = {
  source: "sa_comments",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const articles = (rawData.articles as ArticleData[]) || [];
    const totalComments = (rawData.totalComments as number) || 0;
    const symbol = (rawData.symbol as string) || "UNKNOWN";

    if (totalComments === 0) {
      return {
        signal: "neutral",
        confidence: 0.1,
        summary: "No Seeking Alpha comments found for analysis.",
        details: { keyIdeas: [], catalysts: [], risks: [] },
      };
    }

    const userPrompt = buildUserPrompt(articles, symbol, totalComments);

    console.log(
      `[SA Comments Analyzer] Calling Claude for ${symbol} (${totalComments} comments across ${articles.length} articles)`
    );
    const start = Date.now();

    let text: string;
    if (process.env.ANTHROPIC_API_KEY) {
      const anthropic = getClient();
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: ANALYSIS_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const textBlock = message.content[0];
      text = textBlock?.type === "text" ? textBlock.text : "";
      if (!text) {
        throw new Error(`[SA Comments Analyzer] Empty response from Claude for ${symbol}`);
      }
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[SA Comments Analyzer] SDK response for ${symbol} in ${elapsed}s (${text.length} chars, usage: ${message.usage.input_tokens}in/${message.usage.output_tokens}out)`
      );
    } else {
      console.log(`[SA Comments Analyzer] Using Claude CLI (no ANTHROPIC_API_KEY)`);
      text = await callClaudeViaCLI(ANALYSIS_PROMPT, userPrompt);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[SA Comments Analyzer] CLI response for ${symbol} in ${elapsed}s (${text.length} chars)`
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch (e) {
      throw new Error(
        `[SA Comments Analyzer] Failed to parse Claude JSON for ${symbol}: ${(e as Error).message}. Raw text (first 500 chars): ${text.slice(0, 500)}`
      );
    }
    parsed = parsed as {
      signal?: string;
      confidence?: number;
      summary?: string;
      keyIdeas?: unknown[];
      consensusView?: string;
      contrarianView?: string;
      catalysts?: string[];
      risks?: string[];
    };

    const validSignals = ["bullish", "bearish", "neutral"];
    const signal = validSignals.includes(parsed.signal || "")
      ? (parsed.signal as "bullish" | "bearish" | "neutral")
      : "neutral";

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.3;

    return {
      signal,
      confidence,
      summary: parsed.summary || "Unable to extract summary from analysis.",
      details: {
        keyIdeas: parsed.keyIdeas || [],
        consensusView: parsed.consensusView || null,
        contrarianView: parsed.contrarianView || null,
        catalysts: parsed.catalysts || [],
        risks: parsed.risks || [],
        articleCount: articles.length,
        totalComments,
      },
    };
  },
};
